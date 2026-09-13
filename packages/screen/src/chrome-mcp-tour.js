import { authRouteKey, trustKey } from './cobrowse.js';
import { ChromeMcpAdapter } from './chrome-mcp-adapter.js';
import { tourBrowserCapacity } from './browser-capacity.js';
import { chromium } from 'playwright';
import { BrowserActionPolicy } from './browser-action-policy.js';
import { findCookieConsentCandidate, parseSnapshotElements } from './chrome-snapshot.js';
import { ELEMENT_GEOMETRY_SCRIPT, normalizeElementGeometry, parseEvaluationJson } from './element-geometry.js';
import { loginProbe, verificationScript, LOGIN_STATUS_SCRIPT } from './chrome-login.js';
import { getLogger } from '@repo/logger';

const log = getLogger({ mod: 'chrome-mcp-tour' });
const DEFAULT_LOGIN_VERIFICATION_TIMEOUT_MS = 12_000;
const DEFAULT_LOGIN_VERIFICATION_POLL_MS = 350;
const DEFAULT_LOGIN_FORM_TIMEOUT_MS = 6_000;
const DEFAULT_LOGIN_FORM_POLL_MS = 350;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOf(result) {
    return (result?.content ?? [])
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
}

function selectedPage(result) {
    const lines = textOf(result).split('\n');
    const selected = lines.find((line) => line.includes('[selected]'));
    const match = selected?.match(/^(\d+):\s+(.*?)\s+\[selected\]/);
    const label = match?.[2];
    const url = label?.match(/\((https?:\/\/[^)]+)\)$/)?.[1]
        ?? (label?.match(/^https?:\/\/\S+$/) ? label : null);
    return match ? { pageId: Number(match[1]), url } : null;
}

function uidFor(snapshot, patterns) {
    for (const line of textOf(snapshot).split('\n')) {
        if (!patterns.some((pattern) => pattern.test(line))) continue;
        const match = line.match(/uid=([^\s]+)/);
        if (match) return match[1];
    }
    return null;
}

/** Chrome-MCP browser driver. Browser interactions never bypass its MCP adapter. */
export class ChromeMcpTour {
    constructor({
        startUrl,
        allowedDomains = [],
        auth = null,
        adapter,
        capacity = tourBrowserCapacity,
        actionPolicy = new BrowserActionPolicy(),
        loginVerificationTimeoutMs = DEFAULT_LOGIN_VERIFICATION_TIMEOUT_MS,
        loginVerificationPollMs = DEFAULT_LOGIN_VERIFICATION_POLL_MS,
        loginFormTimeoutMs = DEFAULT_LOGIN_FORM_TIMEOUT_MS,
        loginFormPollMs = DEFAULT_LOGIN_FORM_POLL_MS
    } = {}) {
        this.startUrl = startUrl;
        this.auth = auth;
        this.adapter = adapter ?? new ChromeMcpAdapter({
            launchBrowser: true,
            // Playwright installs Chrome for Testing, which Chrome DevTools MCP
            // officially supports. Playwright supplies the binary only; MCP is
            // the sole controller for this provider.
            executablePath: process.env.CHROME_MCP_EXECUTABLE_PATH || chromium.executablePath()
        });
        this.capacity = capacity;
        this.actionPolicy = actionPolicy;
        this.loginVerificationTimeoutMs = loginVerificationTimeoutMs;
        this.loginVerificationPollMs = loginVerificationPollMs;
        this.loginFormTimeoutMs = loginFormTimeoutMs;
        this.loginFormPollMs = loginFormPollMs;
        this.capacityLease = null;
        this.trustedKeys = new Set([startUrl, ...allowedDomains].map(trustKey).filter(Boolean));
        this.pageId = null;
        this.currentUrl = null;
        this.opened = false;
        this.loggedIn = false;
        this.preparePromise = null;
        this.liveUids = new Set();
        this.uidUrls = new Map();
        this.uidElements = new Map();
        this.cookieConsentOrigins = new Set();
    }

    requiresDemoLogin(targetUrl) {
        try {
            return new URL(this.auth?.loginUrl || this.startUrl).hostname ===
                new URL(targetUrl || this.startUrl).hostname;
        } catch {
            return false;
        }
    }

    async prepare({ loginTargetUrl = null } = {}) {
        if (!this.preparePromise) {
            if (!this.capacityLease) {
                this.capacityLease = { tour: this };
                this.capacity.acquire(this.capacityLease, 'ChromeMcpTour');
            }
            this.preparePromise = this.adapter.connect()
                .then(() => this)
                .catch(async (error) => {
                    await this.adapter.close().catch(() => {});
                    this.capacity.release(this.capacityLease);
                    this.capacityLease = null;
                    throw error;
                });
        }
        const preparation = this.preparePromise;
        try {
            await preparation;
        } finally {
            // A rejected single-flight must not poison every later retry.
            // adapter.connect() is idempotent, so clearing after success is safe.
            if (this.preparePromise === preparation) this.preparePromise = null;
        }
        if (loginTargetUrl && this.requiresDemoLogin(loginTargetUrl)) await this.ensureLogin();
        return this;
    }

    async open(targetUrl) {
        if (this.opened) throw new Error('[ChromeMcpTour] Already open.');
        const destination = targetUrl || this.startUrl;
        await this.prepare({ loginTargetUrl: destination });
        await this.goto(destination);
        this.opened = true;
        return this;
    }

    resolveTrustedUrl(url) {
        const base = this.currentUrl || this.startUrl;
        const target = new URL(url, base).href;
        if (!['http:', 'https:'].includes(new URL(target).protocol) || !this.trustedKeys.has(trustKey(target))) {
            throw new Error(`[ChromeMcpTour] Navigation outside trusted domains is not allowed: ${target}`);
        }
        return target;
    }

    async goto(url) {
        await this.prepare();
        const target = this.resolveTrustedUrl(url);
        if (this.requiresDemoLogin(target)) await this.ensureLogin();
        const result = this.pageId === null
            ? await this.adapter.callTool('new_page', { url: target })
            : await this.adapter.callTool('navigate_page', { pageId: this.pageId, type: 'url', url: target });
        this.assertSuccess(result, 'navigate');
        await this.refreshSelectedPage();
        await this.assertCurrentPageTrusted('navigate');
        await this.ensureCookieConsent();
        return { ready: true, waitMs: 0 };
    }

    async observe() {
        this.assertPage();
        const result = await this.adapter.callTool('take_snapshot', { pageId: this.pageId });
        this.assertSuccess(result, 'snapshot');
        const snapshot = textOf(result);
        this.rememberUids(snapshot);
        return { ok: true, pageId: this.pageId, url: this.currentUrl, snapshot };
    }

    async perform(action, args = {}, { capability = 'agent' } = {}) {
        this.assertPage();
        const toolByAction = {
            click: 'click', fill: 'fill', fillForm: 'fill_form', hover: 'hover',
            pressKey: 'press_key', listPages: 'list_pages', selectPage: 'select_page',
            newPage: 'new_page'
        };
        const tool = toolByAction[action];
        if (!tool) throw new Error(`Unsupported Chrome MCP browser action: ${action}`);
        if (action === 'newPage') args = { ...args, url: this.resolveTrustedUrl(args.url) };
        const referencedUids = action === 'fillForm'
            ? (args.elements ?? []).map((element) => element.uid)
            : (args.uid ? [args.uid] : []);
        if (referencedUids.some((uid) => !this.liveUids.has(uid))) {
            throw new Error('[ChromeMcpTour] Element UID is stale or was not returned by the latest snapshot.');
        }
        if (args.uid) {
            this.actionPolicy.assertAllowed({
                action,
                element: this.uidElements.get(args.uid),
                capability
            });
        }
        if (action === 'click') {
            const destination = this.uidUrls.get(args.uid);
            if (destination && !this.trustedKeys.has(trustKey(destination))) {
                throw new Error(`[ChromeMcpTour] Refusing a click that targets an untrusted URL: ${destination}`);
            }
        }
        const pageScoped = !['listPages', 'newPage'].includes(action);
        const result = await this.adapter.callTool(tool, pageScoped ? { pageId: this.pageId, ...args } : args);
        this.assertSuccess(result, action);
        const returnedText = textOf(result);
        if (returnedText.includes('uid=')) this.rememberUids(returnedText);
        else if (!['listPages'].includes(action)) {
            this.liveUids.clear();
            this.uidUrls.clear();
            this.uidElements.clear();
        }
        if (['selectPage', 'newPage', 'click', 'pressKey'].includes(action)) {
            await this.refreshSelectedPage();
            await this.assertCurrentPageTrusted(action);
        }
        if (
            capability === 'agent'
            && ['selectPage', 'newPage', 'click'].includes(action)
        ) {
            await this.ensureCookieConsent();
        }
        return { ok: true, pageId: this.pageId, url: this.currentUrl, content: textOf(result) };
    }

    async describeElement(uid) {
        this.assertPage();
        if (!this.liveUids.has(uid)) {
            throw new Error('[ChromeMcpTour] Element UID is stale or was not returned by the latest snapshot.');
        }
        const result = await this.adapter.callInternalTool('evaluate_script', {
            pageId: this.pageId,
            function: ELEMENT_GEOMETRY_SCRIPT,
            args: [uid],
            waitForStableDom: false
        });
        this.assertSuccess(result, 'element geometry');
        const geometry = normalizeElementGeometry(parseEvaluationJson(textOf(result)));
        if (!geometry) throw new Error('[ChromeMcpTour] Element has no visible geometry in the current viewport.');
        return { ok: true, uid, pageId: this.pageId, url: this.currentUrl, geometry };
    }

    async screenshot() {
        this.assertPage();
        const result = await this.adapter.callTool('take_screenshot', { pageId: this.pageId, format: 'png' });
        this.assertSuccess(result, 'screenshot');
        const image = result.content.find((item) => item.type === 'image' && item.data);
        if (!image) throw new Error('[ChromeMcpTour] Screenshot returned no image.');
        return Buffer.from(image.data, 'base64');
    }

    // Some product logins render the password field only after a client-side
    // redirect/hydration finishes (observed live: a protected demo route that
    // redirects to /login before the form mounts). A single snapshot right
    // after navigation can beat that render, so this polls a bounded budget
    // instead of failing on the first miss; pages whose form is already
    // there resolve on the first iteration with no added delay.
    async resolveLoginForm() {
        const deadline = Date.now() + this.loginFormTimeoutMs;
        let consentChecked = false;
        while (true) {
            let snapshot = await this.adapter.callTool('take_snapshot', { pageId: this.pageId });
            this.assertSuccess(snapshot, 'login snapshot');
            this.rememberUids(textOf(snapshot));
            if (!consentChecked) {
                consentChecked = true;
                const consent = await this.ensureCookieConsent({ snapshot });
                if (consent.dismissed) {
                    snapshot = await this.adapter.callTool('take_snapshot', { pageId: this.pageId });
                    this.assertSuccess(snapshot, 'post-cookie login snapshot');
                    this.rememberUids(textOf(snapshot));
                }
            }
            const probe = loginProbe(textOf(snapshot), this.auth);
            const resolved = await this.evaluateLogin(probe.function, probe.uids);
            if (!resolved.error && resolved.indices) return { probe, resolved };
            if (Date.now() >= deadline) {
                throw new Error(`[ChromeMcpTour] ${resolved.error || 'Could not resolve login form.'}`);
            }
            await delay(this.loginFormPollMs);
        }
    }

    async ensureLogin() {
        if (this.loggedIn || !this.auth?.password) return;
        const username = this.auth.username || this.auth.email;
        if (!username) throw new Error('[ChromeMcpTour] Demo credentials are incomplete.');
        const loginUrl = this.resolveTrustedUrl(this.auth.loginUrl || this.startUrl);
        const opened = this.pageId === null
            ? await this.adapter.callTool('new_page', { url: loginUrl })
            : await this.adapter.callTool('navigate_page', { pageId: this.pageId, type: 'url', url: loginUrl });
        this.assertSuccess(opened, 'login navigation');
        await this.refreshSelectedPage();

        const { probe, resolved } = await this.resolveLoginForm();
        const [userUid, passwordUid, submitUid] = resolved.indices.map(index => probe.uids[index]);
        const elements = [
            { uid: userUid, value: username },
            { uid: passwordUid, value: this.auth.password }
        ];
        // Retry a value lost during hydration once, never submit unchecked values.
        for (let attempt = 0; attempt < 2; attempt++) {
            this.assertSuccess(await this.adapter.callTool('fill_form', {
                pageId: this.pageId, elements
            }), 'login form fill');
            const verified = await this.evaluateLogin(
                verificationScript(username, this.auth.password), [userUid, passwordUid, submitUid]
            );
            if (!verified.sameForm) throw new Error('[ChromeMcpTour] Login controls changed form before submit.');
            if (verified.usernameMatches && verified.passwordMatches) {
                if (!verified.valid) throw new Error('[ChromeMcpTour] Login form validation failed before submit.');
                break;
            }
            if (attempt === 1) throw new Error('[ChromeMcpTour] Login field values did not persist; refusing submit.');
        }
        const loginRoute = this.currentUrl ? authRouteKey(this.currentUrl) : null;
        this.assertSuccess(await this.adapter.callTool('click', {
            pageId: this.pageId,
            uid: submitUid,
            includeSnapshot: true
        }), 'login submit');
        await this.waitForLoginCompletion(loginRoute);
        this.loggedIn = true;
    }

    async waitForLoginCompletion(loginRoute) {
        const deadline = Date.now() + this.loginVerificationTimeoutMs;

        while (true) {
            await this.refreshSelectedPage();
            await this.assertCurrentPageTrusted('login');
            if (loginRoute && this.currentUrl && authRouteKey(this.currentUrl) !== loginRoute) return;

            const status = await this.evaluateLogin(LOGIN_STATUS_SCRIPT);
            if (status.hasError) throw new Error('[ChromeMcpTour] Login page reported an error after submit.');
            if (status.passwordVisible === false) return;

            if (Date.now() >= deadline) {
                throw new Error(
                    `[ChromeMcpTour] Demo login did not complete within ${this.loginVerificationTimeoutMs}ms; ` +
                    'password form is still visible.'
                );
            }
            await delay(this.loginVerificationPollMs);
        }
    }

    async evaluateLogin(functionSource, args = []) {
        const result = await this.adapter.callInternalTool('evaluate_script', {
            pageId: this.pageId, function: functionSource, args, waitForStableDom: false
        }).catch(() => { throw new Error('[ChromeMcpTour] Login DOM verification failed.'); });
        // Do not echo evaluation output: a failed script may contain credentials.
        if (!result?.ok) throw new Error('[ChromeMcpTour] Login DOM verification failed.');
        const value = parseEvaluationJson(textOf(result));
        if (!value) throw new Error('[ChromeMcpTour] Login DOM verification returned no result.');
        return value;
    }

    async ensureCookieConsent({ snapshot = null } = {}) {
        try {
            if (!this.currentUrl) return { checked: false, dismissed: false };
            const origin = new URL(this.currentUrl).origin;
            if (this.cookieConsentOrigins.has(origin)) {
                return { checked: true, dismissed: false, cached: true };
            }

            const liveSnapshot = snapshot ?? await this.adapter.callTool('take_snapshot', { pageId: this.pageId });
            this.assertSuccess(liveSnapshot, 'cookie snapshot');
            const snapshotText = textOf(liveSnapshot);
            this.rememberUids(snapshotText);
            const candidate = findCookieConsentCandidate(snapshotText);
            if (!candidate) return { checked: true, dismissed: false };

            await this.perform(
                'click',
                { uid: candidate.uid, includeSnapshot: true },
                { capability: 'system:cookie' }
            );
            const after = await this.adapter.callTool('take_snapshot', { pageId: this.pageId });
            this.assertSuccess(after, 'cookie verification');
            const remaining = findCookieConsentCandidate(textOf(after));
            if (!remaining) this.cookieConsentOrigins.add(origin);
            this.rememberUids(textOf(after));
            return { checked: true, dismissed: !remaining, candidate: candidate.name };
        } catch (error) {
            // Consent cleanup improves presentation but must not turn an
            // otherwise usable product page into a terminal navigation error.
            log.warn('Chrome MCP cookie consent cleanup failed; continuing', { error: error.message });
            return { checked: true, dismissed: false, error: error.message };
        }
    }

    async refreshSelectedPage() {
        const pages = await this.adapter.callTool('list_pages');
        this.assertSuccess(pages, 'list pages');
        const selected = selectedPage(pages);
        if (!selected) throw new Error('[ChromeMcpTour] MCP returned no selected page.');
        this.pageId = selected.pageId;
        this.currentUrl = selected.url ?? this.currentUrl;
    }

    async assertCurrentPageTrusted(action) {
        if (this.currentUrl && !this.trustedKeys.has(trustKey(this.currentUrl))) {
            const untrustedUrl = this.currentUrl;
            await this.adapter.callTool('navigate_page', {
                pageId: this.pageId,
                type: 'url',
                url: 'about:blank'
            }).catch(() => {});
            this.currentUrl = 'about:blank';
            this.liveUids.clear();
            this.uidUrls.clear();
            this.uidElements.clear();
            throw new Error(`[ChromeMcpTour] ${action} landed outside trusted domains: ${untrustedUrl}`);
        }
    }

    assertSuccess(result, action) {
        if (!result?.ok) throw new Error(`[ChromeMcpTour] ${action} failed: ${textOf(result) || 'unknown MCP error'}`);
    }

    assertPage() {
        if (this.pageId === null) throw new Error('[ChromeMcpTour] No active page. Open the tour first.');
    }

    rememberUids(snapshotText) {
        this.liveUids.clear();
        this.uidUrls.clear();
        this.uidElements.clear();
        for (const element of parseSnapshotElements(snapshotText)) {
            this.liveUids.add(element.uid);
            this.uidElements.set(element.uid, element);
            const url = element.line.match(/\burl="(https?:\/\/[^"]+)"/)?.[1];
            if (url) this.uidUrls.set(element.uid, url);
        }
    }

    async recover() {
        await this.resetRuntime();
    }

    async resetRuntime() {
        await this.adapter.close().catch(() => {});
        if (this.capacityLease) {
            this.capacity.release(this.capacityLease);
            this.capacityLease = null;
        }
        this.pageId = null;
        this.currentUrl = null;
        this.opened = false;
        this.loggedIn = false;
        this.preparePromise = null;
        this.liveUids.clear();
        this.uidUrls.clear();
        this.uidElements.clear();
        this.cookieConsentOrigins.clear();
    }

    async close() {
        await this.resetRuntime();
    }
}

export { selectedPage, uidFor };
