import { chromium } from 'playwright';

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

export class GuidedTour {
    constructor({ startUrl, viewport = { width: 1280, height: 720 } } = {}) {
        this.startUrl = startUrl;
        this.viewport = viewport;
        this.browser = null;
        this.page = null;
    }

    async open() {
        if (activeBrowsers.size >= MAX_CONCURRENT_BROWSERS) {
            throw new Error(
                `[GuidedTour] Concurrent browser limit reached (${MAX_CONCURRENT_BROWSERS}). ` +
                'Try again later or increase MAX_TOUR_BROWSERS env var.'
            );
        }
        this.browser = await chromium.launch({ headless: true });
        activeBrowsers.add(this.browser);
        const context = await this.browser.newContext({ viewport: this.viewport });
        this.page = await context.newPage();
        if (this.startUrl) await this.page.goto(this.startUrl, { waitUntil: 'networkidle' });
        return this;
    }

    /** Navigate to a URL/path within the product. */
    async goto(url) {
        await this.page.goto(url, { waitUntil: 'networkidle' });
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

    /** Click an element as part of a tour step. */
    async click(selector) {
        await this.page.click(selector);
    }

    /** Returns a PNG screenshot buffer (the agent turns this into a frame). */
    async screenshot() {
        return this.page.screenshot({ type: 'png' });
    }

    async close() {
        if (this.browser) {
            activeBrowsers.delete(this.browser);
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}
