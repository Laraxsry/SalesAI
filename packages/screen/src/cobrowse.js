import { chromium } from 'playwright';
import { getDomain } from 'tldts';

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
const EMAIL_FIELD_SELECTORS = [
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[name="email" i]',
    'input[id="email" i]',
    'input[name="username" i]',
    'input[id="username" i]'
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

export class GuidedTour {
    /**
     * @param {string} startUrl - the product's primary URL (e.g. Product.websiteUrl).
     * @param {string[]} allowedDomains - additional domains the seller has
     *   explicitly approved in the console (e.g. sister/portfolio sites).
     *   This list is never populated from a visitor conversation — that's
     *   the trust boundary the SSRF guard below depends on.
     * @param {'playwright'|'stagehand'} backend - which browser backend to drive.
     * @param {({loginUrl?:string, email:string, password:string, selectors?:{email?:string,password?:string,submit?:string}}|{cookies?:object[], localStorage?:Record<string,string>})|null} auth -
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

    async open() {
        if (this.browser || this.stagehand) {
            throw new Error('[GuidedTour] Already open. Call close() before opening again.');
        }
        if (activeBrowsers.size >= MAX_CONCURRENT_BROWSERS) {
            throw new Error(
                `[GuidedTour] Concurrent browser limit reached (${MAX_CONCURRENT_BROWSERS}). ` +
                'Try again later or increase MAX_TOUR_BROWSERS env var.'
            );
        }

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
            this.browser = await chromium.launch({ headless: true });
            activeBrowsers.add(this.browser);
            context = await this.browser.newContext({ viewport: this.viewport });
            this.page = await context.newPage();
        }

        // Authenticate before the first navigation so the tour lands already
        // logged in. Two distinct sources, two distinct shapes:
        //  - Product.demoSession: seller-configured, long-lived demo account
        //    -> logs into the real form fresh every time (see login()).
        //  - Session.transientAuth: visitor's own live cookies/localStorage,
        //    handed over for this one session only and deleted from the DB
        //    right after being read (see agent-worker/src/agent.js) -> no
        //    staleness concern, so the direct snapshot injection is fine.
        if (this.auth?.email && this.auth?.password) {
            await this.login();
        } else if (this.auth?.cookies || this.auth?.localStorage) {
            await injectSessionSnapshot(context, this.page, this.startUrl, this.auth);
        }

        if (this.startUrl) {
            // 'networkidle' hangs/crashes on SPAs that keep a live connection
            // open (polling, websockets, dashboards) — they never go idle.
            await this.page.goto(this.startUrl, { waitUntil: 'domcontentloaded' });
            await this.page.waitForTimeout(3000);
            // A same-owner redirect at tour start (root domain -> app
            // subdomain, say) is a one-time hop under the seller's own
            // control, not something a visitor's chat message steered —
            // trust wherever it actually landed for the rest of the tour.
            const landedKey = trustKey(this.page.url());
            if (landedKey) this.trustedKeys.add(landedKey);
        }
        return this;
    }

    /**
     * Logs into the product with the seller-provided demo credentials
     * (Product.demoSession = { loginUrl?, email, password, selectors? }).
     * Runs fresh at the start of every tour — unlike the old cookie/
     * localStorage snapshot approach, a fresh login has no expiry to go
     * stale against.
     */
    async login() {
        await loginWithCredentials(this.page, this.auth, this.startUrl);
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
 * site's own login form — auto-detecting the email/password/submit fields
 * unless overridden. Runs fresh every call, so (unlike a captured cookie/
 * localStorage snapshot) there's no access-token expiry window for it to go
 * stale against. Shared by `GuidedTour#login` (screen-share demo) and the
 * URL knowledge crawler (`@app/worker-ingestion`'s `extractors/url.js`),
 * which both need to view a product's auth-gated pages.
 *
 * @param {import('playwright').Page} page
 * @param {{loginUrl?:string, email:string, password:string, selectors?:{email?:string,password?:string,submit?:string}}} auth
 * @param {string} [fallbackUrl] - used as the login page URL when `auth.loginUrl` isn't set.
 */
export async function loginWithCredentials(page, auth, fallbackUrl) {
    const { loginUrl, email, password, selectors = {} } = auth;
    if (!email || !password) {
        throw new Error('[GuidedTour] demoSession is missing email/password.');
    }
    const target = loginUrl || fallbackUrl;
    if (!target) {
        throw new Error('[GuidedTour] demoSession has no loginUrl and no fallback URL to log in at.');
    }

    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const emailField = await locateLoginField(page, selectors.email, EMAIL_FIELD_SELECTORS, 'email');
    if (!emailField) {
        throw new Error(
            '[GuidedTour] Could not locate an email/username field on the login page. Configure demoSession.selectors.email.'
        );
    }
    await emailField.fill(email);

    const passwordField = await locateLoginField(page, selectors.password, PASSWORD_FIELD_SELECTORS, 'password');
    if (!passwordField) {
        throw new Error(
            '[GuidedTour] Could not locate a password field on the login page. Configure demoSession.selectors.password.'
        );
    }
    await passwordField.fill(password);

    const submitButton = await locateLoginField(page, selectors.submit, SUBMIT_SELECTORS, 'submit');
    if (submitButton) {
        await submitButton.click();
    } else {
        await passwordField.press('Enter');
    }

    await page.waitForTimeout(3000);
}
