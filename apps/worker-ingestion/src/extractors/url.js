import { checkSSRFUrl } from '@repo/utils';
import { chromium } from 'playwright';

// Same-origin pages only, capped by count (not depth) — simplest bound on
// crawl cost/time regardless of how the site's link graph is shaped.
const MAX_CRAWL_PAGES = Number(process.env.URL_CRAWL_MAX_PAGES || 10);

/** Strips the hash fragment so '#/tab-a' and '#/tab-b' anchors on the same
 * route don't get treated as distinct pages; returns null for unparsable URLs. */
function normalizeUrl(href) {
    try {
        const u = new URL(href);
        u.hash = '';
        return u.href;
    } catch {
        return null;
    }
}

async function injectAuth(context, page, rootUrl, auth) {
    if (auth?.cookies) {
        await context.addCookies(auth.cookies);
    }
    if (auth?.localStorage) {
        const origin = new URL(rootUrl).origin;
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.evaluate((storage) => {
            for (const [key, value] of Object.entries(storage)) {
                window.localStorage.setItem(key, value);
            }
        }, auth.localStorage);
    }
}

/** Navigates to one page, returns its visible text plus every <a href> found on it. */
async function extractPage(page, urlStr) {
    // 'networkidle' hangs/crashes on SPAs that keep a live connection open
    // (polling, websockets, dashboards) — they never go idle. Wait for the
    // DOM instead, then give client-side rendering a fixed grace period.
    await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const { text, links } = await page.evaluate(() => {
        document.querySelectorAll('script, style, noscript, iframe, link, meta').forEach((el) => el.remove());
        const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
        return { text: document.body.innerText || document.body.textContent || '', links };
    });

    return { text: text.replace(/\s+/g, ' ').trim(), links };
}

/**
 * Crawls a site starting at `urlStr`, following same-origin links up to
 * `URL_CRAWL_MAX_PAGES` pages (BFS, one shared authenticated browser
 * context), and returns the combined text with a `[Page: <url>]` marker per
 * page — so a single-page-app whose panel exposes several routes gets fully
 * indexed from one seller-provided URL instead of requiring one Knowledge
 * source per route.
 *
 * @param {string} urlStr
 * @param {{ cookies?: Array, localStorage?: Record<string,string> }|null} [auth] -
 *   Same shape as the guided tour's demo-session auth (see `@repo/screen`'s
 *   `GuidedTour`). Without it, auth-gated pages are scraped anonymously and
 *   only the public/login view gets indexed.
 * @param {(current:number, max:number) => void} [onProgress]
 */
export async function extractFromUrl(urlStr, auth = null, onProgress = null) {
    // SSRF guard on the root URL; re-checked per discovered link below.
    await checkSSRFUrl(urlStr);

    const rootOrigin = new URL(urlStr).origin;
    const rootUrl = normalizeUrl(urlStr) || urlStr;

    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        if (auth) {
            await injectAuth(context, page, urlStr, auth);
        }

        const visited = new Set();
        const queue = [rootUrl];
        const pages = [];

        while (queue.length && visited.size < MAX_CRAWL_PAGES) {
            const next = queue.shift();
            if (!next || visited.has(next)) continue;

            if (next !== rootUrl) {
                try {
                    await checkSSRFUrl(next);
                } catch {
                    continue; // unsafe/unreachable link — skip it, don't abort the crawl
                }
            }

            visited.add(next);

            let result;
            try {
                result = await extractPage(page, next);
            } catch {
                continue; // one broken page shouldn't kill the whole crawl
            }

            pages.push({ url: next, text: result.text });
            onProgress?.(visited.size, MAX_CRAWL_PAGES);

            for (const link of result.links) {
                const normalized = normalizeUrl(link);
                if (normalized && normalized.startsWith(rootOrigin) && !visited.has(normalized)) {
                    queue.push(normalized);
                }
            }
        }

        return pages.map((p) => `[Page: ${p.url}]\n${p.text}`).join('\n\n');
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}
