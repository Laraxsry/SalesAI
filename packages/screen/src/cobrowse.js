import { chromium } from 'playwright';
import { getDomain } from 'tldts';
import { getLogger } from '@repo/logger';

const log = getLogger({ mod: 'guided-tour' });

/**
 * AI-driven guided tour (screen-share mode A).
 *
 * Opens a real browser of the seller's product URL, performs natural-language
 * navigation steps, highlights elements, and exposes screenshots/video frames
 * that the agent-worker publishes into the LiveKit room while narrating.
 *
 * Two backends:
 *  - playwright (default): deterministic + AI actions via highlight/goto/click.
 *  - browserbase/stagehand (optional): cloud browser with computer-use agent.
 */
/** Global set to track active browser instances across all sessions. */
const activeBrowsers = new Set();
const MAX_CONCURRENT_BROWSERS = Number(process.env.MAX_TOUR_BROWSERS || 3);

/**
 * Candidate selectors for auto-detecting a login form's fields, tried in
 * order until one matches a visible element. Overridable per-product via
 * `auth.selectors` (see GuidedTour#login) for sites these don't match.
 */
const USERNAME_FIELD_SELECTORS = [
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[name="email" i]',
    'input[id="email" i]',
    'input[name="username" i]',
    'input[id="username" i]',
    'input[name="login" i]',
    'input[id="login" i]',
    'input[name="user" i]',
    'input[id="user" i]'
];
const PASSWORD_FIELD_SELECTORS = ['input[type="password"]'];
const SUBMIT_SELECTORS = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Giriş")',
    'button:has-text("Giriş Yap")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Sign in")'
];

/**
 * Resolves a URL to a "trust key" for the SSRF guard below.
 *
 * For URLs with a recognised Public Suffix List domain (`allowPrivateDomains:
 * true` so multi-tenant hosts like vercel.app/github.io are split per-tenant),
 * the key is the registrable domain (eTLD+1) — so subdomains of the same
 * product (app./panel./www...) are treated as equivalent.
 *
 * For anything WITHOUT a recognised public suffix — raw IPs (incl.
 * decimal/hex/IPv6 obfuscation) and `localhost` — there is no domain-
 * ownership structure to reason about, so we fall back to the full origin
 * (protocol+host+port). This is deliberately the strictest possible check
 * for that category: it still lets a product legitimately hosted on a bare
 * IP navigate within itself, but treats every other port on that same host
 * as untrusted (otherwise `trusted=localhost:5432` would also trust
 * `localhost:6379`, turning the guard into a same-host port scanner).
 */
export function trustKey(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    return getDomain(url, { allowPrivateDomains: true }) || parsed.origin;
}

/**
 * Injects a captured cookie/localStorage snapshot into `page` — used for
 * `Session.transientAuth` (the visitor's own live session, handed over
 * single-use for one tour and deleted from the DB immediately after being
 * read; see agent-worker/src/agent.js). Unlike a seller's long-lived demo
 * account, this snapshot is consumed within seconds of being captured, so
 * the access-token-expiry problem that made this approach unusable for
 * `Product.demoSession` (see `loginWithCredentials`) doesn't apply here.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} page
 * @param {string} rootUrl - used to resolve the origin localStorage is set on.
 * @param {{cookies?: object[], localStorage?: Record<string,string>}} auth
 */
export async function injectSessionSnapshot(context, page, rootUrl, auth) {
    if (auth.cookies) {
        await context.addCookies(auth.cookies);
    }
    if (auth.localStorage && rootUrl) {
        const origin = new URL(rootUrl).origin;
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.evaluate((storage) => {
            for (const [key, value] of Object.entries(storage)) {
                window.localStorage.setItem(key, value);
            }
        }, auth.localStorage);
    }
}

export function assertHttpUrl(url) {
    let target;
    try {
        target = new URL(url);
    } catch {
        throw new Error(`[GuidedTour] Invalid URL: ${url}`);
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error(`[GuidedTour] Unsupported URL scheme: ${target.protocol}`);
    }
}

/** Compares auth routes without treating a canonical trailing slash as navigation. */
export function authRouteKey(url) {
    const parsed = url instanceof URL ? url : new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${pathname}`;
}

export class GuidedTour {
    /**
     * @param {string} startUrl - the product's primary URL (e.g. Product.websiteUrl).
     * @param {string[]} allowedDomains - additional domains the seller has
     *   explicitly approved in the console (e.g. sister/portfolio sites).
     *   This list is never populated from a visitor conversation — that's
     *   the trust boundary the SSRF guard below depends on.
     * @param {'playwright'|'stagehand'} backend - which browser backend to drive.
     * @param {({loginUrl?:string, username?:string, email?:string, password:string, selectors?:{username?:string,email?:string,password?:string,submit?:string}}|{cookies?:object[], localStorage?:Record<string,string>})|null} auth -
     *   Either `Product.demoSession` (seller-configured demo account — logs
     *   into the real form fresh every tour via login(), since a captured
     *   snapshot would go stale the moment the underlying access token
     *   expires, often ~15min) or `Session.transientAuth` (the visitor's own
     *   live cookies/localStorage, single-use — injected directly via
     *   injectSessionSnapshot() since it's consumed within seconds of being
     *   captured and staleness isn't a concern).
     */
    constructor({
        startUrl,
        allowedDomains = [],
        viewport = { width: 1280, height: 720 },
        backend = 'playwright',
        auth = null
    } = {}) {
        this.startUrl = startUrl;
        this.viewport = viewport;
        this.backend = backend;
        this.auth = auth;
        this.browser = null;
        this.page = null;
        this.stagehand = null;
        this.trustedKeys = new Set(
            [startUrl, ...allowedDomains].map(trustKey).filter(Boolean)
        );
    }

    /**
     * Throws if the browser's current page is outside every trusted domain.
     * Also blanks the page first so the untrusted content isn't left on
     * screen for the ~1s tour-frame publish loop to stream to the visitor.
     */
    async assertCurrentPageTrusted(actionLabel) {
        const landedUrl = this.page.url();
        const landedKey = trustKey(landedUrl);
        if (!landedKey || !this.trustedKeys.has(landedKey)) {
            await this.page.goto('about:blank').catch(() => {});
            throw new Error(
                `[GuidedTour] ${actionLabel} landed outside the trusted domain(s): ${landedUrl}`
            );
        }
    }

    /**
     * Whether the tour's first destination (`targetUrl`, e.g. the opening
     * playbook node's URL — defaults to `startUrl` when the caller doesn't
     * know one yet) actually lives on the demoSession's own domain.
     * `Product.demoSession` logs into a long-lived demo account whose login
     * form commonly lives on a different *host* than the seller's public
     * marketing site (e.g. `demo.cyberverse.com.tr` vs
     * `www.cyberverse.com.tr`) — attempting that login before every tour
     * regardless of where the tour actually opens cost every session
     * ~46-50s (3 retries × goto+settle+12s redirect race, see
     * md/backend/playbook_session_log.md §4.4/§7.1) even when the first
     * (sometimes only) stop was the public site and never touched the demo
     * panel at all.
     *
     * Compared by exact hostname, not `trustKey`'s eTLD+1 — `demo.` and
     * `www.` subdomains are deliberately treated as equivalent for *trust*
     * (see `trustKey` docs) but are exactly the two hosts this check exists
     * to tell apart, so collapsing them here would defeat the guard.
     */
    requiresDemoLogin(targetUrl) {
        let demoHost;
        let requestedHost;
        try {
            demoHost = new URL(this.auth?.loginUrl || this.startUrl).hostname;
            requestedHost = new URL(targetUrl || this.startUrl).hostname;
        } catch {
            return false;
        }
        return Boolean(demoHost && requestedHost && demoHost === requestedHost);
    }

    /** @param {string} [targetUrl] - the first destination the caller actually wants to show (e.g. the opening playbook node's URL); defaults to `startUrl` when not yet known. */
    async open(targetUrl) {
        if (this.browser || this.stagehand) {
            throw new Error('[GuidedTour] Already open. Call close() before opening again.');
        }
        if (activeBrowsers.size >= MAX_CONCURRENT_BROWSERS) {
            throw new Error(
                `[GuidedTour] Concurrent browser limit reached (${MAX_CONCURRENT_BROWSERS}). ` +
                'Try again later or increase MAX_TOUR_BROWSERS env var.'
            );
        }

        // Per-phase timing: `open()` has no explicit timeouts, so it inherits
        // Playwright's defaults (30s for launch, 30s for goto) plus a hard 3s
        // settle wait — up to ~63s in the worst case. When a caller is waiting
        // on this before it can speak, knowing WHICH phase burned the time is
        // the difference between fixing the browser and fixing the site.
        const openStartedAt = Date.now();
        const phase = {};
        log.info('GuidedTour open: begin', { backend: this.backend, startUrl: this.startUrl });

        let context;
        if (this.backend === 'stagehand') {
            try {
                const { Stagehand } = await import('@browserbasehq/stagehand');
                this.stagehand = new Stagehand({
                    env: process.env.BROWSERBASE_API_KEY ? 'BROWSERBASE' : 'LOCAL',
                    browserbaseSessionCreateParams: { projectId: process.env.BROWSERBASE_PROJECT_ID }
                });
                await this.stagehand.init();
                this.page = this.stagehand.page;
                context = this.stagehand.context;
                activeBrowsers.add(this.stagehand);
            } catch (err) {
                console.warn('[GuidedTour] Stagehand backend failed, falling back to local playwright.', err.message);
                this.backend = 'playwright';
                this.stagehand = null;
            }
        }

        if (this.backend === 'playwright') {
            let t = Date.now();
            this.browser = await chromium.launch({ headless: true });
            phase.launchMs = Date.now() - t;
            activeBrowsers.add(this.browser);

            t = Date.now();
            context = await this.browser.newContext({ viewport: this.viewport });
            this.page = await context.newPage();
            phase.contextMs = Date.now() - t;
            log.info('GuidedTour open: browser ready', { launchMs: phase.launchMs, contextMs: phase.contextMs });
        }

        // Authenticate before the first navigation so the tour lands already
        // logged in. Two distinct sources, two distinct shapes:
        //  - Product.demoSession: seller-configured, long-lived demo account
        //    -> logs into the real form fresh every time (see login()).
        //  - Session.transientAuth: visitor's own live cookies/localStorage,
        //    handed over for this one session only and deleted from the DB
        //    right after being read (see agent-worker/src/agent.js) -> no
        //    staleness concern, so the direct snapshot injection is fine.
        const hasDemoCredentials = Boolean((this.auth?.username || this.auth?.email) && this.auth?.password);
        const usedCredentialLogin = hasDemoCredentials && this.requiresDemoLogin(targetUrl);
        if (hasDemoCredentials && !usedCredentialLogin) {
            log.info('GuidedTour open: skipping demoSession login, first destination is outside its domain', {
                loginDomain: trustKey(this.auth?.loginUrl || this.startUrl),
                targetDomain: trustKey(targetUrl || this.startUrl)
            });
        }
        if (usedCredentialLogin) {
            const t = Date.now();
            await this.login();
            phase.loginMs = Date.now() - t;
            log.info('GuidedTour open: credential login done', { loginMs: phase.loginMs });
        } else if (this.auth?.cookies || this.auth?.localStorage) {
            const t = Date.now();
            await injectSessionSnapshot(context, this.page, this.startUrl, this.auth);
            phase.snapshotMs = Date.now() - t;
        }

        if (this.startUrl && !usedCredentialLogin) {
            // 'networkidle' hangs/crashes on SPAs that keep a live connection
            // open (polling, websockets, dashboards) — they never go idle.
            let t = Date.now();
            await this.page.goto(this.startUrl, { waitUntil: 'domcontentloaded' });
            phase.gotoMs = Date.now() - t;
            log.info('GuidedTour open: initial navigation done', { url: this.startUrl, gotoMs: phase.gotoMs });

            t = Date.now();
            await this.page.waitForTimeout(3000);
            phase.settleMs = Date.now() - t;
        }
        log.info('GuidedTour open: complete', { ...phase, totalMs: Date.now() - openStartedAt });
        // When credential login redirects into an authenticated in-app route,
        // keep that landed page instead of immediately bouncing back to the
        // public marketing URL and losing the useful session context.
        const landedKey = trustKey(this.page.url());
        if (landedKey) this.trustedKeys.add(landedKey);
        return this;
    }

    /**
     * Logs into the product with the seller-provided demo credentials
     * (Product.demoSession = { loginUrl?, username/email, password, selectors? }).
     * Runs fresh at the start of every tour — unlike the old cookie/
     * localStorage snapshot approach, a fresh login has no expiry to go
     * stale against.
     */
    async login() {
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                await loginWithCredentials(this.page, this.auth, this.startUrl);
                return;
            } catch (error) {
                lastError = error;
                if (attempt < 3) await this.page.waitForTimeout(500);
            }
        }
        throw lastError;
    }

    /** Navigate to a URL/path within the product. */
    async goto(url) {
        // The knowledge base (and the LLM) usually knows a page only as an
        // in-app route — e.g. "/home", matching the product's own
        // routesConfig.js — not a full absolute URL. Resolve that against
        // the page we're already on, exactly like a browser resolves a
        // relative link, before validating. The resolved absolute URL still
        // goes through the same trust-key check below, so this only adds
        // relative-path support — it doesn't weaken the SSRF guard.
        let target = url;
        try {
            new URL(url);
        } catch {
            target = new URL(url, this.page.url()).href;
        }

        assertHttpUrl(target);
        const targetKey = trustKey(target);
        if (!targetKey || !this.trustedKeys.has(targetKey)) {
            throw new Error(`[GuidedTour] Navigation outside the product's domain is not allowed: ${target}`);
        }
        await this.page.goto(target, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(3000);
        // The check above only validated the requested URL; the site itself
        // may then have redirected further (open-redirect abuse). Re-check
        // where the browser actually ended up.
        await this.assertCurrentPageTrusted('navigate_to');
    }

    /**
     * Visually highlight an element (draws an outline) so the customer can
     * follow. Resolved via Playwright's locator API (not a page.evaluate +
     * document.querySelector) so Playwright-only selector engines like
     * `text=`/`role=` — which the LLM is instructed to use — actually work;
     * raw querySelector only understands plain CSS.
     */
    async highlight(selector) {
        const locator = this.page.locator(selector).first();
        try {
            await locator.waitFor({ state: 'attached', timeout: 3000 });
        } catch {
            return; // not found — same silent no-op as before
        }
        await locator.evaluate((el) => {
            el.style.outline = '3px solid #6d5efc';
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    /**
     * Click an element as part of a tour step. Wired to the `click_element`
     * LLM tool (see @repo/agent tools.js). Unlike goto(), the destination
     * comes from the page's own DOM, not an argument we can pre-validate,
     * so this is a post-hoc check.
     */
    async click(selector) {
        // Selector'ı Playwright'ın locator API'siyle çözüyoruz (document.querySelector
        // değil) — aksi halde LLM'in kullandığı `text=`/`role=` gibi Playwright-özel
        // selector motorları çıplak DOM API'sinde geçersiz sayılıp hata fırlatıyordu.
        const locator = this.page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: 5000 });

        // Güvenlik Katmanı: Read-Only Mode (Zararlı işlemleri engelle)
        const isDangerous = await locator.evaluate((el) => {
            const tag = el.tagName.toLowerCase();
            const type = el.getAttribute('type')?.toLowerCase();
            // Form elemanlarına ve submit butonlarına tıklamayı engelle
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
            if (tag === 'button' && type === 'submit') return true;
            return false;
        });

        if (isDangerous) {
            throw new Error(`[GuidedTour] Security constraint: Clicking on form inputs or submit buttons is disabled in read-only mode.`);
        }

        await this.page.click(selector);
        await this.assertCurrentPageTrusted('click');
    }

    /**
     * Scroll the toured page so the agent can show what is below (or above)
     * the fold. Wired to the `scroll_page` LLM tool.
     *
     * Scrolls the *scrolling container that actually owns the overflow*, not
     * blindly `window`: product dashboards routinely put their content in an
     * inner `overflow-y: auto` panel next to a fixed sidebar/header, and on
     * those pages `window.scrollBy` moves nothing at all. The document is
     * still preferred whenever it is itself scrollable, so ordinary pages
     * behave the ordinary way.
     *
     * Scrolling cannot leave the page, so unlike goto()/click() there is no
     * trust re-check to do here.
     *
     * @param {'down'|'up'|'top'|'bottom'} [direction]
     * @param {number} [amount] screens to move, for 'down'/'up' only (default 1)
     * @returns {Promise<{scrollTop:number, scrollHeight:number, atTop:boolean, atBottom:boolean}>}
     *   where the page ended up, so the agent can tell whether more content
     *   is left instead of scrolling into a dead end and narrating nothing.
     */
    async scroll(direction = 'down', amount = 1) {
        if (!['down', 'up', 'top', 'bottom'].includes(direction)) {
            throw new Error(`[GuidedTour] Unsupported scroll direction: ${direction}`);
        }

        await this.page.evaluate(
            ({ direction: dir, amount: n }) => {
                const doc = document.scrollingElement || document.documentElement;
                const overflows = (el) => el.scrollHeight - el.clientHeight > 4;

                let target = doc;
                if (!overflows(doc)) {
                    // Largest visible element that owns its own vertical overflow —
                    // the main content panel, not a tiny scrollable dropdown.
                    const panels = Array.from(document.querySelectorAll('div, main, section, article'))
                        .filter((el) => overflows(el) && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
                        .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
                    if (panels.length > 0) target = panels[0];
                }

                // Less than a full screen per step, so the customer keeps a
                // strip of the previous content as a visual anchor.
                const step = target.clientHeight * 0.8 * (n > 0 ? n : 1);
                if (dir === 'top') target.scrollTo({ top: 0, behavior: 'smooth' });
                else if (dir === 'bottom') target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
                else target.scrollBy({ top: dir === 'up' ? -step : step, behavior: 'smooth' });

                // Read back only after the animation has run — see below.
                window.__tourScrollTarget = target;
            },
            { direction, amount }
        );

        // Smooth scrolling is animated and lazy-loaded rows render as they
        // enter the viewport; without this the published video frame (and any
        // read_tour_screen right after) would still show the pre-scroll page —
        // and scrollTop would still read its pre-scroll value.
        await this.page.waitForTimeout(1200);

        const { scrollTop, scrollHeight, clientHeight } = await this.page.evaluate(() => {
            const target = window.__tourScrollTarget || document.scrollingElement || document.documentElement;
            return { scrollTop: target.scrollTop, scrollHeight: target.scrollHeight, clientHeight: target.clientHeight };
        });
        return {
            scrollTop,
            scrollHeight,
            atTop: scrollTop <= 4,
            atBottom: scrollTop + clientHeight >= scrollHeight - 4
        };
    }

    /** Returns a PNG screenshot buffer (the agent turns this into a frame). */
    async screenshot() {
        return this.page.screenshot({ type: 'png' });
    }

    async close() {
        if (this.backend === 'stagehand' && this.stagehand) {
            activeBrowsers.delete(this.stagehand);
            await this.stagehand.close();
            this.stagehand = null;
        } else if (this.browser) {
            activeBrowsers.delete(this.browser);
            await this.browser.close();
            this.browser = null;
        }
        this.page = null;
    }
}

/**
 * Finds the first visible element on `page` matching `override` (a
 * seller-supplied CSS selector) or, absent that, the first matching
 * candidate from the auto-detect list. Returns null if nothing matches and
 * no override was given; throws if an override was given but matched
 * nothing (a misconfigured override should surface immediately, not
 * silently fall through to guessing).
 */
async function locateLoginField(page, override, candidates, label) {
    if (override) {
        const el = page.locator(override).first();
        if ((await el.count()) === 0) {
            throw new Error(`[GuidedTour] Configured ${label} selector matched nothing: ${override}`);
        }
        return el;
    }
    for (const selector of candidates) {
        try {
            const el = page.locator(selector).first();
            if ((await el.count()) > 0 && (await el.isVisible())) return el;
        } catch {
            // Selector unsupported on this page (e.g. :has-text on a weird
            // DOM) — try the next candidate instead of failing the tour.
        }
    }
    return null;
}

/**
 * Logs `page` into a product using seller-provided demo credentials via the
 * site's own login form — auto-detecting the username-or-email/password/submit fields
 * unless overridden. Runs fresh every call, so (unlike a captured cookie/
 * localStorage snapshot) there's no access-token expiry window for it to go
 * stale against. Shared by `GuidedTour#login` (screen-share demo) and the
 * URL knowledge crawler (`@app/worker-ingestion`'s `extractors/url.js`),
 * which both need to view a product's auth-gated pages.
 *
 * @param {import('playwright').Page} page
 * @param {{loginUrl?:string, username?:string, email?:string, password:string, selectors?:{username?:string,email?:string,password?:string,submit?:string}}} auth
 * @param {string} [fallbackUrl] - used as the login page URL when `auth.loginUrl` isn't set.
 */
export async function loginWithCredentials(page, auth, fallbackUrl) {
    const { loginUrl, password, selectors = {} } = auth;
    const username = auth.username || auth.email;
    const usernameSelector = selectors.username || selectors.email;
    if (!username || !password) {
        throw new Error('[GuidedTour] demoSession is missing username/email or password.');
    }
    const target = loginUrl || fallbackUrl;
    if (!target) {
        throw new Error('[GuidedTour] demoSession has no loginUrl and no fallback URL to log in at.');
    }

    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Some sites show a cookie banner that can interfere with clicks or
    // subsequent JS-driven login flows. If an explicit accept button is
    // visible, dismiss it before interacting with the form.
    const acceptCookiesButton = page.locator('button:has-text("Kabul Et")').first();
    if ((await acceptCookiesButton.count().catch(() => 0)) > 0) {
        try {
            if (await acceptCookiesButton.isVisible()) {
                await acceptCookiesButton.evaluate((button) => {
                    // Do not click cookie controls inside login forms: malformed
                    // banners can submit the form with empty credentials.
                    const banner = button.closest('#cookieConsent, [class*="cookie" i], [id*="cookie" i]');
                    if (banner) banner.style.display = 'none';
                    else button.style.display = 'none';
                });
                await page.waitForTimeout(250);
            }
        } catch {
            // Non-fatal — continue with the login attempt.
        }
    }

    const usernameField = await locateLoginField(page, usernameSelector, USERNAME_FIELD_SELECTORS, 'username');
    if (!usernameField) {
        throw new Error(
            '[GuidedTour] Could not locate a username/email field on the login page. Configure demoSession.selectors.username.'
        );
    }
    await usernameField.fill(username);

    const passwordField = await locateLoginField(page, selectors.password, PASSWORD_FIELD_SELECTORS, 'password');
    if (!passwordField) {
        throw new Error(
            '[GuidedTour] Could not locate a password field on the login page. Configure demoSession.selectors.password.'
        );
    }
    await passwordField.fill(password);

    // Do not submit unless Playwright can read both values back. Some legacy
    // login pages occasionally reload while delayed key events are in flight.
    if (await usernameField.inputValue() !== username) await usernameField.fill(username);
    if (await passwordField.inputValue() !== password) await passwordField.fill(password);

    const submitButton = await locateLoginField(page, selectors.submit, SUBMIT_SELECTORS, 'submit');
    // Use the URL after the initial page load: many sites canonicalize
    // `/login` to `/login/`, which must not count as a successful login.
    const loginPageOriginAndPath = authRouteKey(page.url());
    const waitForRedirect = page.waitForURL(
        (url) => authRouteKey(url) !== loginPageOriginAndPath,
        { timeout: 12_000 }
    ).then(() => 'redirect').catch(() => null);

    const waitForInlineError = page
        .locator('#Label_HATA, .text-danger, .validation-summary-errors')
        .first()
        .waitFor({ state: 'visible', timeout: 12_000 })
        .then(() => 'error')
        .catch(() => null);

    if (submitButton) {
        await submitButton.click();
    } else {
        await passwordField.press('Enter');
    }

    const loginOutcome = await Promise.race([waitForRedirect, waitForInlineError]);
    // A broad error selector can also match harmless styling on the landing
    // dashboard. Navigation away from the login route is authoritative.
    if (loginOutcome === 'redirect' || authRouteKey(page.url()) !== loginPageOriginAndPath) {
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1000);
        return;
    }

    const loginErrorText = await page.locator('#Label_HATA, .text-danger, .validation-summary-errors')
        .first()
        .textContent()
        .catch(() => '');
    const normalizedError = loginErrorText?.trim();
    if (normalizedError) {
        throw new Error(`[GuidedTour] Login failed: ${normalizedError}`);
    }

    // If no inline error appeared and no redirect happened, fail loudly with
    // the current URL so site-specific flows can be debugged quickly.
    throw new Error(`[GuidedTour] Login did not complete. Still on ${page.url()}`);
}
