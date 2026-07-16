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
function trustKey(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    return getDomain(url, { allowPrivateDomains: true }) || parsed.origin;
}

function assertHttpUrl(url) {
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
     * @param {{cookies?: object[], localStorage?: Record<string,string>}|null} auth -
     *   optional demo-session material (cookies/localStorage) injected before
     *   the tour starts, so the tour can show authenticated product screens.
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

        // Inject demo-session material (seller-provided, see Product model)
        // before the first navigation so the tour lands already authenticated.
        if (this.auth) {
            if (this.auth.cookies) {
                await context.addCookies(this.auth.cookies);
            }
            if (this.auth.localStorage && this.startUrl) {
                const origin = new URL(this.startUrl).origin;
                await this.page.goto(origin, { waitUntil: 'domcontentloaded' });
                await this.page.evaluate((storage) => {
                    for (const [key, value] of Object.entries(storage)) {
                        window.localStorage.setItem(key, value);
                    }
                }, this.auth.localStorage);
            }
        }

        if (this.startUrl) {
            await this.page.goto(this.startUrl, { waitUntil: 'networkidle' });
            // A same-owner redirect at tour start (root domain -> app
            // subdomain, say) is a one-time hop under the seller's own
            // control, not something a visitor's chat message steered —
            // trust wherever it actually landed for the rest of the tour.
            const landedKey = trustKey(this.page.url());
            if (landedKey) this.trustedKeys.add(landedKey);
        }
        return this;
    }

    /** Navigate to a URL/path within the product. */
    async goto(url) {
        assertHttpUrl(url);
        const targetKey = trustKey(url);
        if (!targetKey || !this.trustedKeys.has(targetKey)) {
            throw new Error(`[GuidedTour] Navigation outside the product's domain is not allowed: ${url}`);
        }
        await this.page.goto(url, { waitUntil: 'networkidle' });
        // The check above only validated the requested URL; the site itself
        // may then have redirected further (open-redirect abuse). Re-check
        // where the browser actually ended up.
        await this.assertCurrentPageTrusted('navigate_to');
    }

    /** Visually highlight an element (draws an outline) so the customer can follow. */
    async highlight(selector) {
        await this.page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
                el.style.outline = '3px solid #6d5efc';
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, selector);
    }

    /**
     * Click an element as part of a tour step. Not currently wired to any
     * LLM tool (see @repo/agent tools.js) — hardened anyway since it's
     * public API and a future click-driven tool would inherit this guard
     * for free. Unlike goto(), the destination comes from the page's own
     * DOM, not an argument we can pre-validate, so this is a post-hoc check.
     */
    async click(selector) {
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
