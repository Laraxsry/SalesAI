import { chromium } from 'playwright';
import { getDomain } from 'tldts';
import { getLogger } from '@repo/logger';
import { waitForStableContent } from '@repo/utils';

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
const PAGE_READY_TIMEOUT_MS = Number(process.env.TOUR_PAGE_READY_TIMEOUT_MS || 3000);

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
 * Injects a captured cookie/localStorage snapshot into a BrowserContext — used for
 * `Session.transientAuth` (the visitor's own live session, handed over
 * single-use for one tour and deleted from the DB immediately after being
 * read; see agent-worker/src/agent.js). Unlike a seller's long-lived demo
 * account, this snapshot is consumed within seconds of being captured, so
 * the access-token-expiry problem that made this approach unusable for
 * `Product.demoSession` (see `loginWithCredentials`) doesn't apply here.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string} rootUrl - used to resolve the origin localStorage is set on.
 * @param {{cookies?: object[], localStorage?: Record<string,string>}} auth
 */
export async function injectSessionSnapshot(context, rootUrl, auth) {
    if (auth.cookies) {
        await context.addCookies(auth.cookies);
    }
    if (auth.localStorage && rootUrl) {
        const origin = new URL(rootUrl).origin;
        // Seed storage before the product's own scripts run on the first real
        // destination. This avoids the old origin-only setup navigation while
        // preserving strict origin isolation across every page/frame.
        const initScript = await context.addInitScript(({ allowedOrigin, storage }) => {
            if (window.location.origin !== allowedOrigin) return;
            for (const [key, value] of Object.entries(storage)) {
                window.localStorage.setItem(key, value);
            }
        }, { allowedOrigin: origin, storage: auth.localStorage });
        return {
            origin,
            dispose: async () => initScript?.dispose?.()
        };
    }
    return null;
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

/**
 * Waits for useful page content instead of sleeping for a fixed amount of
 * time after every navigation. `domcontentloaded` only says the HTML parser
 * finished; client-rendered applications may still have an empty root at
 * that point. Conversely, a server-rendered page may already be ready and
 * should not pay an unconditional three-second penalty.
 *
 * This is deliberately a small Playwright policy function rather than part
 * of the tour orchestrator: products can eventually supply a stronger
 * product-specific ready selector without coupling browser lifecycle code to
 * any one UI framework. A timeout degrades to the already-loaded page instead
 * of failing the whole tour — the previous fixed delay offered no readiness
 * guarantee either.
 *
 * @param {import('playwright').Page} page
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{ready:boolean, waitMs:number}>}
 */
export async function waitForPageReady(page, { timeoutMs = PAGE_READY_TIMEOUT_MS } = {}) {
    const startedAt = Date.now();
    try {
        await page.waitForFunction(
            () => {
                const isVisible = (element) => {
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return rect.width > 0
                        && rect.height > 0
                        && style.visibility !== 'hidden'
                        && style.display !== 'none';
                };
                const hasUsefulContent = (root) => {
                    if (!isVisible(root)) return false;
                    // Products may provide an explicit contract when their
                    // own loading lifecycle is more precise than inference.
                    if (root.hasAttribute('data-tour-ready')) return true;
                    // `body.children.length > 0` is insufficient: an empty
                    // SPA mount plus script tags would pass while the visitor
                    // still sees a blank canvas. Require rendered text or an
                    // interactive/media surface that can actually be shown.
                    const text = root.innerText?.trim();
                    const surface = root.matches('canvas, iframe, video, img[src], button, input, select, textarea, table')
                        ? root
                        : root.querySelector('canvas, iframe, video, img[src], button, input, select, textarea, table');
                    return Boolean(text || (surface && isVisible(surface)));
                };

                const appRoots = [...document.querySelectorAll('[data-tour-ready], main, #root, #app')];
                if (appRoots.some(hasUsefulContent)) return true;

                // SSR/static pages may not use a conventional app root. Ignore
                // infrastructure-only body children so scripts/styles cannot
                // make an otherwise blank document look ready.
                const bodyContent = [...(document.body?.children ?? [])]
                    .filter((element) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK'].includes(element.tagName));
                return bodyContent.some(hasUsefulContent);
            },
            undefined,
            { timeout: timeoutMs }
        );

        // Let layout/paint settle for two frames. Unlike a wall-clock sleep,
        // this returns as soon as the browser has actually rendered the DOM.
        await page.evaluate(() => new Promise((resolve) => {
            const fallback = setTimeout(resolve, 100);
            requestAnimationFrame(() => requestAnimationFrame(() => {
                clearTimeout(fallback);
                resolve();
            }));
        }));
        return { ready: true, waitMs: Date.now() - startedAt };
    } catch (error) {
        log.warn('GuidedTour page readiness timed out; continuing with loaded page', {
            timeoutMs,
            error: error.message
        });
        return { ready: false, waitMs: Date.now() - startedAt };
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
     * @param {(page: import('playwright').Page) => Promise<{ready:boolean, waitMs:number}>} waitForReady -
     *   navigation-readiness policy; injectable so lifecycle orchestration is
     *   independent from any one readiness strategy.
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
        auth = null,
        waitForReady = waitForPageReady
    } = {}) {
        this.startUrl = startUrl;
        this.viewport = viewport;
        this.backend = backend;
        this.auth = auth;
        this.waitForReady = waitForReady;
        this.browser = null;
        this.context = null;
        this.page = null;
        this.stagehand = null;
        this.opened = false;
        this.preparePromise = null;
        this.loginPromise = null;
        this.browserReservation = null;
        this.snapshotInitScript = null;
        this.lifecycleEpoch = 0;
        // Set the instant a credential login succeeds (in `open()` or,
        // on-demand, in `goto()`) and never cleared until `close()` — a
        // single yes/no across the whole tour is all that's needed, because
        // `this.page` is the same page/context for the tour's entire
        // lifetime (see cobrowse.js's own single-page design): once logged
        // in, the session cookies are already there for every later goto()
        // to the same domain, so there's nothing per-page to track.
        this.loggedIn = false;
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
     * Whether `targetUrl` actually lives on the demoSession's own domain.
     * Called from two places: `open()` (against the tour's first
     * destination — defaults to `startUrl` when the caller doesn't know one
     * yet) and `goto()` (against whatever it's asked to navigate to next,
     * on-demand, gated on `this.loggedIn` — see goto()'s own comment for why
     * a single first-destination check in `open()` alone isn't enough for a
     * tour that reaches the demo domain several nodes in).
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

    /**
     * Creates the expensive browser/context resources without showing a page
     * to the visitor. Calls are single-flight and idempotent, so session-start
     * prewarm and a later `open()` can safely race and share the same work.
     *
     * `loginTargetUrl` is intentionally explicit: the tour owns the mechanics
     * of authentication, while the playbook orchestrator owns the policy of
     * whether a future node justifies speculative login.
     *
     * @param {{loginTargetUrl?: string|null}} [options]
     */
    async prepare({ loginTargetUrl = null } = {}) {
        await this.ensureBrowserReady();
        if (loginTargetUrl) await this.ensureDemoLogin(loginTargetUrl);
        return this;
    }

    async ensureBrowserReady() {
        if (this.page) return this;
        if (this.preparePromise) return this.preparePromise;

        const epoch = this.lifecycleEpoch;
        this.preparePromise = (async () => {
            if (activeBrowsers.size >= MAX_CONCURRENT_BROWSERS) {
                throw new Error(
                    `[GuidedTour] Concurrent browser limit reached (${MAX_CONCURRENT_BROWSERS}). ` +
                    'Try again later or increase MAX_TOUR_BROWSERS env var.'
                );
            }

            // Reserve synchronously before the first await. Without this, two
            // concurrent prepare() calls from different sessions can both see
            // the same free slot and launch past the configured browser cap.
            this.browserReservation = { tour: this };
            activeBrowsers.add(this.browserReservation);

            const prepareStartedAt = Date.now();
            const phase = {};
            log.info('GuidedTour prepare: begin', { backend: this.backend });

            if (this.backend === 'stagehand') {
                let stagehand = null;
                try {
                    const { Stagehand } = await import('@browserbasehq/stagehand');
                    stagehand = new Stagehand({
                        env: process.env.BROWSERBASE_API_KEY ? 'BROWSERBASE' : 'LOCAL',
                        browserbaseSessionCreateParams: { projectId: process.env.BROWSERBASE_PROJECT_ID }
                    });
                    await stagehand.init();
                    if (epoch !== this.lifecycleEpoch) {
                        await stagehand.close().catch(() => {});
                        throw new Error('[GuidedTour] Preparation cancelled because the tour was closed.');
                    }
                    this.stagehand = stagehand;
                    this.page = stagehand.page;
                    this.context = stagehand.context;
                    activeBrowsers.delete(this.browserReservation);
                    this.browserReservation = null;
                    activeBrowsers.add(stagehand);
                } catch (err) {
                    // init() can fail before the candidate is assigned to the
                    // tour. Close that partial resource explicitly so the
                    // Stagehand fallback never leaks a remote/local session.
                    if (stagehand && stagehand !== this.stagehand) {
                        await stagehand.close().catch(() => {});
                    }
                    if (epoch !== this.lifecycleEpoch) throw err;
                    console.warn('[GuidedTour] Stagehand backend failed, falling back to local playwright.', err.message);
                    this.backend = 'playwright';
                    this.stagehand = null;
                }
            }

            if (this.backend === 'playwright') {
                let t = Date.now();
                const browser = await chromium.launch({ headless: true });
                phase.launchMs = Date.now() - t;
                if (epoch !== this.lifecycleEpoch) {
                    await browser.close().catch(() => {});
                    throw new Error('[GuidedTour] Preparation cancelled because the tour was closed.');
                }
                this.browser = browser;
                activeBrowsers.delete(this.browserReservation);
                this.browserReservation = null;
                activeBrowsers.add(browser);

                t = Date.now();
                this.context = await browser.newContext({ viewport: this.viewport });
                this.page = await this.context.newPage();
                phase.contextMs = Date.now() - t;
            }

            // A visitor-provided snapshot is session-scoped and should be
            // injected during preparation. Seller demo credentials are handled
            // separately by ensureDemoLogin() because their need is URL-based.
            if (this.auth?.cookies || this.auth?.localStorage) {
                const t = Date.now();
                this.snapshotInitScript = await injectSessionSnapshot(this.context, this.startUrl, this.auth);
                phase.snapshotMs = Date.now() - t;
            }

            log.info('GuidedTour prepare: complete', {
                ...phase,
                totalMs: Date.now() - prepareStartedAt
            });
            return this;
        })();

        try {
            return await this.preparePromise;
        } catch (error) {
            // A partially-created browser must never consume a pool slot after
            // failed preparation. `close()` also invalidates in-flight work.
            await this.close().catch(() => {});
            throw error;
        } finally {
            this.preparePromise = null;
        }
    }

    async ensureDemoLogin(targetUrl) {
        const hasDemoCredentials = Boolean((this.auth?.username || this.auth?.email) && this.auth?.password);
        if (!hasDemoCredentials || this.loggedIn || !this.requiresDemoLogin(targetUrl)) return;
        if (this.loginPromise) return this.loginPromise;

        const startedAt = Date.now();
        this.loginPromise = this.loginInIsolatedPage()
            .then(() => {
                this.loggedIn = true;
                log.info('GuidedTour credential login prepared', { loginMs: Date.now() - startedAt });
            })
            .finally(() => {
                this.loginPromise = null;
            });
        return this.loginPromise;
    }

    /**
     * Authenticates in a temporary page that shares the tour's BrowserContext.
     * Cookies/storage therefore become available to the visitor-visible page,
     * while a long-running background login can never race or overwrite that
     * page's foreground navigation. The fallback supports backends/fakes that
     * expose only one page.
     */
    async loginInIsolatedPage() {
        const canCreateIsolatedPage = Boolean(this.context?.newPage);
        const loginPage = canCreateIsolatedPage ? await this.context.newPage() : this.page;
        try {
            await this.login(loginPage);
        } finally {
            if (canCreateIsolatedPage && loginPage !== this.page) {
                await loginPage.close().catch(() => {});
            }
        }
    }

    /**
     * The snapshot init script only needs to survive until the first document
     * on its configured origin. Removing it then prevents a later navigation
     * from overwriting a token that the product refreshed during the session.
     */
    async releaseSnapshotInitializerForCurrentOrigin() {
        if (!this.snapshotInitScript) return;
        let currentOrigin;
        try {
            currentOrigin = new URL(this.page.url()).origin;
        } catch {
            return;
        }
        if (currentOrigin !== this.snapshotInitScript.origin) return;

        const initializer = this.snapshotInitScript;
        this.snapshotInitScript = null;
        await initializer.dispose().catch((error) => {
            log.warn('GuidedTour snapshot init-script cleanup failed (non-fatal)', { error: error.message });
        });
    }

    /**
     * Opens the visitor-visible tour at exactly one destination. Browser launch
     * and authentication may already be complete thanks to `prepare()`; no
     * intermediate startUrl navigation is performed.
     *
     * @param {string} [targetUrl]
     */
    async open(targetUrl) {
        if (this.opened) {
            throw new Error('[GuidedTour] Already open. Call close() before opening again.');
        }

        const destination = targetUrl || this.startUrl;
        const openStartedAt = Date.now();
        log.info('GuidedTour open: begin', { backend: this.backend, destination });
        await this.prepare({ loginTargetUrl: destination });
        if (destination) await this.goto(destination);
        this.opened = true;
        log.info('GuidedTour open: complete', {
            destination,
            totalMs: Date.now() - openStartedAt
        });
        return this;
    }

    /**
     * Logs into the product with the seller-provided demo credentials
     * (Product.demoSession = { loginUrl?, username/email, password, selectors? }).
     * Runs fresh at the start of every tour — unlike the old cookie/
     * localStorage snapshot approach, a fresh login has no expiry to go
     * stale against.
     */
    async login(page = this.page) {
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                await loginWithCredentials(page, this.auth, this.startUrl);
                return;
            } catch (error) {
                lastError = error;
                if (attempt < 3) await page.waitForTimeout(500);
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
        await this.ensureBrowserReady();

        let target = url;
        try {
            new URL(url);
        } catch {
            const currentUrl = this.page.url();
            const baseUrl = currentUrl && currentUrl !== 'about:blank' ? currentUrl : this.startUrl;
            target = new URL(url, baseUrl).href;
        }

        assertHttpUrl(target);
        const targetKey = trustKey(target);
        if (!targetKey || !this.trustedKeys.has(targetKey)) {
            throw new Error(`[GuidedTour] Navigation outside the product's domain is not allowed: ${target}`);
        }

        // `open()` only ever checked the tour's FIRST destination against
        // demoSession's domain (see requiresDemoLogin's own docs) — correct
        // for that one call, but it meant a tour that opens on the public
        // site and only reaches the demo panel several nodes later (exactly
        // this project's own reference playbook — see agent_flow.md) never
        // logged in at all: goto() had no equivalent check of its own, so
        // the visitor landed on a bare login screen instead of the actual
        // dashboard. Same demoHost/hasDemoCredentials logic as open(),
        // applied here too, gated on `this.loggedIn` so a tour that keeps
        // returning to the demo domain only ever logs in once (see the
        // constructor comment on `loggedIn` for why a plain boolean is
        // enough). A failure here surfaces as a rejected goto() exactly like
        // any other navigation failure — the existing [playbook:failed]
        // handling in playbook-runtime.js already covers that, no new
        // failure path needed.
        await this.ensureDemoLogin(target);

        const startedAt = Date.now();
        await this.page.goto(target, { waitUntil: 'domcontentloaded' });
        // Validate the redirect result before running any page-side readiness
        // JavaScript. A second check after readiness catches late SPA redirects.
        await this.assertCurrentPageTrusted('navigate_to');
        await this.releaseSnapshotInitializerForCurrentOrigin();
        const readiness = await this.waitForReady(this.page);
        // The check before goto only validated the requested URL; the site
        // itself may redirect further (open-redirect abuse). Re-check after
        // client rendering as well.
        await this.assertCurrentPageTrusted('navigate_to');
        log.info('GuidedTour navigation ready', {
            url: target,
            navigationMs: Date.now() - startedAt,
            ready: readiness.ready,
            readinessMs: readiness.waitMs
        });
        return readiness;
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
        // A click can load a new page/route just like goto() — same
        // adaptive wait (see goto()'s comment); on a click that DOESN'T
        // navigate (a toggle, an accordion) this resolves quickly since two
        // consecutive reads already match, so it's not a meaningful tax on
        // ordinary in-page clicks.
        await waitForStableContent(this.page);
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
     * Supports directional scrolling ('down', 'up', 'top', 'bottom') by screen amounts,
     * as well as targeted scrolling to a specific section, heading, or element selector.
     *
     * @param {'down'|'up'|'top'|'bottom'|object} [directionOrOptions]
     * @param {number} [amount] screens to move, for 'down'/'up' only (default 1)
     * @param {string|null} [target] optional element selector or text heading to scroll into view
     * @returns {Promise<{scrollTop:number, scrollHeight:number, atTop:boolean, atBottom:boolean, targetFound?:boolean, visibleHeadings?:string[]}>}
     *   where the page ended up, so the agent can tell whether more content
     *   is left instead of scrolling into a dead end and narrating nothing.
     */
    async scroll(directionOrOptions = 'down', amount = 1, target = null) {
        let direction = 'down';
        let amt = 1;
        let tgt = null;

        if (typeof directionOrOptions === 'object' && directionOrOptions !== null) {
            direction = directionOrOptions.direction || 'down';
            amt = directionOrOptions.amount ?? 1;
            tgt = directionOrOptions.target || null;
        } else {
            direction = directionOrOptions || 'down';
            amt = amount ?? 1;
            tgt = target || null;
        }

        if (!['down', 'up', 'top', 'bottom'].includes(direction)) {
            throw new Error(`[GuidedTour] Unsupported scroll direction: ${direction}`);
        }

        let targetFound = false;
        if (tgt && typeof tgt === 'string' && tgt.trim().length > 0) {
            const cleanTarget = tgt.trim();
            try {
                const locator = this.page.locator(
                    cleanTarget.startsWith('text=') || cleanTarget.startsWith('#') || cleanTarget.startsWith('.')
                        ? cleanTarget
                        : `text=${cleanTarget}`
                ).first();
                const count = await locator.count().catch(() => 0);
                if (count > 0) {
                    await locator.evaluate((el) => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        window.__tourScrollTarget = el;
                    }).catch(() => {});
                    targetFound = true;
                }
            } catch {
                // Ignore locator error, will fall back to directional scroll
            }
        }

        if (!targetFound) {
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
                { direction, amount: amt }
            );
        }

        // Smooth scrolling is animated and lazy-loaded rows render as they
        // enter the viewport; without this the published video frame (and any
        // read_tour_screen right after) would still show the pre-scroll page —
        // and scrollTop would still read its pre-scroll value.
        await this.page.waitForTimeout(600);

        const result = await this.page.evaluate(() => {
            const target = window.__tourScrollTarget || document.scrollingElement || document.documentElement;
            const scrollTop = target?.scrollTop ?? 0;
            const scrollHeight = target?.scrollHeight ?? 0;
            const clientHeight = target?.clientHeight ?? 0;

            const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"], section header, [data-section]'))
                .filter((el) => {
                    const rect = el.getBoundingClientRect();
                    return rect.top >= -50 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + 100 && rect.height > 0 && rect.width > 0;
                })
                .map((el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '))
                .filter((t) => t.length > 0 && t.length < 80)
                .slice(0, 5);

            return {
                scrollTop,
                scrollHeight,
                clientHeight,
                visibleHeadings: headings
            };
        });

        const scrollTop = result?.scrollTop ?? 0;
        const scrollHeight = result?.scrollHeight ?? 0;
        const clientHeight = result?.clientHeight ?? 0;
        const visibleHeadings = result?.visibleHeadings ?? [];

        return {
            scrollTop,
            scrollHeight,
            atTop: scrollTop <= 4,
            atBottom: scrollTop + clientHeight >= scrollHeight - 4,
            ...(tgt ? { targetFound } : {}),
            visibleHeadings
        };
    }

    /** Returns a PNG screenshot buffer (the agent turns this into a frame). */
    async screenshot() {
        return this.page.screenshot({ type: 'png' });
    }

    async close() {
        this.lifecycleEpoch += 1;
        if (this.snapshotInitScript) {
            await this.snapshotInitScript.dispose().catch(() => {});
            this.snapshotInitScript = null;
        }
        if (this.browserReservation) {
            activeBrowsers.delete(this.browserReservation);
            this.browserReservation = null;
        }
        if (this.backend === 'stagehand' && this.stagehand) {
            activeBrowsers.delete(this.stagehand);
            await this.stagehand.close();
            this.stagehand = null;
        } else if (this.browser) {
            activeBrowsers.delete(this.browser);
            await this.browser.close();
            this.browser = null;
        }
        this.context = null;
        this.page = null;
        // A fresh `open()` after this is a fresh browser/context — no
        // cookies survive close(), so whatever `loggedIn` meant for the old
        // page no longer holds for the new one.
        this.loggedIn = false;
        this.opened = false;
        this.loginPromise = null;
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
