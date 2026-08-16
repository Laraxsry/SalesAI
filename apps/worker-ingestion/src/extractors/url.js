import { checkSSRFUrl } from '@repo/utils';
import { loginWithCredentials } from '@repo/screen';
import { chromium } from 'playwright';

// Same-origin pages only, capped by count (not depth) — simplest bound on
// crawl cost/time regardless of how the site's link graph is shaped. Large
// dashboards/panels with deep sidebars need a bigger budget than a typical
// marketing site, hence the higher default vs. the old 10.
const MAX_CRAWL_PAGES = Number(process.env.URL_CRAWL_MAX_PAGES || 40);

// Bound on how many collapsed-nav toggles we click per page — a large panel
// can have dozens of accordion sections; this keeps a single page's expand
// pass from running away.
const MAX_EXPAND_CLICKS = Number(process.env.URL_CRAWL_MAX_EXPAND_CLICKS || 25);

// Below this many pages, "repeats across most pages" isn't a meaningful
// signal (with 2 pages, anything shared between them would get stripped,
// including genuinely relevant shared content).
const BOILERPLATE_MIN_PAGES = 3;
// Fraction of crawled pages a line has to appear on verbatim to be treated
// as chrome (sidebar nav, header, logged-in-user info) rather than real
// content.
const BOILERPLATE_THRESHOLD = Number(process.env.URL_CRAWL_BOILERPLATE_THRESHOLD || 0.6);

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

/**
 * Clicks collapsed nav toggles (`aria-expanded="false"`) so nested sidebar
 * links — common in dashboard panels ("Reports" expanding into a dozen
 * sub-pages) — actually mount into the DOM before we scrape `<a href>`.
 * Best-effort: a toggle that doesn't open anything, or a page with none at
 * all, is harmless — this just costs a few no-op clicks. Bounded by
 * MAX_EXPAND_CLICKS so a page that keeps re-adding `aria-expanded="false"`
 * elements (e.g. a toggle whose expanded state doesn't stick) can't loop.
 */
async function expandCollapsedNav(page) {
    for (let i = 0; i < MAX_EXPAND_CLICKS; i++) {
        const toggle = page.locator('[aria-expanded="false"]').first();
        if ((await toggle.count()) === 0) break;
        try {
            await toggle.click({ timeout: 2000 });
            await page.waitForTimeout(250);
        } catch {
            break; // not clickable (covered/detached) — stop rather than retry forever
        }
    }
}

/**
 * Navigates to one page, returns its visible text plus every <a href> found
 * on it (after expanding any collapsed nav sections). Returns
 * `{ ok: false }` for 4xx/5xx responses — a 404'd link shouldn't get its
 * error-page boilerplate indexed as product knowledge.
 */
async function extractPage(page, urlStr) {
    // 'networkidle' hangs/crashes on SPAs that keep a live connection open
    // (polling, websockets, dashboards) — they never go idle. Wait for the
    // DOM instead, then give client-side rendering a fixed grace period.
    const response = await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    if (response && response.status() >= 400) {
        return { ok: false, status: response.status() };
    }

    await expandCollapsedNav(page);

    const { text, links } = await page.evaluate(() => {
        document.querySelectorAll('script, style, noscript, iframe, link, meta').forEach((el) => el.remove());
        const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
        return { text: document.body.innerText || document.body.textContent || '', links };
    });

    // Line breaks are kept (not flattened to one line here) — they're what
    // stripRepeatedBoilerplate() below diffs across pages to find repeated
    // nav/header chrome; each individually-blank/whitespace line is dropped
    // but line boundaries themselves survive until after that pass runs.
    const lines = text
        .split(/\r\n?|\n/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    return { ok: true, text: lines.join('\n'), links };
}

/**
 * Removes lines that appear verbatim on at least `BOILERPLATE_THRESHOLD` of
 * the crawled pages — sidebar nav, header chrome, logged-in-user info —
 * before any of this text is chunked/embedded. Left in, that boilerplate
 * dominates every single page's chunk text (it's often the majority of the
 * page's raw innerText on a typical dashboard sidebar layout), which both
 * wastes a large fraction of the embedding tokens spent on the crawl and
 * makes retrieval barely able to tell pages apart, since most of what got
 * embedded for every page is identical. Purely statistical (counts which
 * lines repeat) rather than DOM-selector-based, so it needs no site-specific
 * configuration — works the same regardless of how a given customer's site
 * happens to be structured.
 *
 * @param {{url:string, text:string}[]} pages - `text` is `\n`-joined lines (see extractPage)
 * @returns {{url:string, text:string}[]}
 */
export function stripRepeatedBoilerplate(pages) {
    let boilerplateLines = new Set();

    if (pages.length >= BOILERPLATE_MIN_PAGES) {
        const pageLineSets = pages.map((p) => new Set(p.text.split('\n')));
        const pageCountByLine = new Map();
        for (const lineSet of pageLineSets) {
            for (const line of lineSet) {
                pageCountByLine.set(line, (pageCountByLine.get(line) || 0) + 1);
            }
        }
        const minPages = Math.ceil(pages.length * BOILERPLATE_THRESHOLD);
        boilerplateLines = new Set(
            [...pageCountByLine.entries()].filter(([, count]) => count >= minPages).map(([line]) => line)
        );
    }

    // Always flattens `\n`-joined lines (see extractPage) into the single-
    // line-per-page text the rest of the pipeline expects, whether or not
    // any boilerplate was actually found to filter out.
    return pages.map((p) => ({
        url: p.url,
        text: p.text
            .split('\n')
            .filter((line) => !boilerplateLines.has(line))
            .join(' ')
    }));
}

/**
 * Crawls a site starting at `urlStr`, following same-origin links up to
 * `URL_CRAWL_MAX_PAGES` pages (BFS, one shared authenticated browser
 * context). Returns both the combined text with a `[Page: <url>]` marker per
 * page (`text` — kept for `meta.extractedText`/backfill, human-scannable as
 * a single blob) and the raw per-page breakdown (`pages` — what
 * `handleIngestSource()` uses to chunk each page separately and tag its
 * chunks with `metadata.pageUrl`, so the Console detail modal can group
 * retrieved chunks under the page they came from instead of one
 * undifferentiated wall of crawled text).
 *
 * @param {string} urlStr
 * @param {{loginUrl?:string, email:string, password:string, selectors?:{email?:string,password?:string,submit?:string}}|null} [auth] -
 *   Same shape as the guided tour's demo-session auth (see `@repo/screen`'s
 *   `loginWithCredentials`) — logs in via the product's own login form before
 *   crawling. Without it, auth-gated pages are scraped anonymously and only
 *   the public/login view gets indexed.
 * @param {(current:number, max:number) => void} [onProgress]
 * @returns {Promise<{ text: string, pages: { url: string, text: string }[] }>}
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
            await loginWithCredentials(page, auth, urlStr);
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
            onProgress?.(visited.size, MAX_CRAWL_PAGES);

            // 404/5xx — don't index the error page, and it has no real links
            // to follow (its "not found" boilerplate isn't a route map).
            if (!result.ok) continue;

            pages.push({ url: next, text: result.text });

            for (const link of result.links) {
                const normalized = normalizeUrl(link);
                if (normalized && normalized.startsWith(rootOrigin) && !visited.has(normalized)) {
                    queue.push(normalized);
                }
            }
        }

        const cleanedPages = stripRepeatedBoilerplate(pages);
        return {
            text: cleanedPages.map((p) => `[Page: ${p.url}]\n${p.text}`).join('\n\n'),
            pages: cleanedPages
        };
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}
