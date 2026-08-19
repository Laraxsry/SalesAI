import { checkSSRFUrl } from '@repo/utils';
import { loginWithCredentials } from '@repo/screen';
import { chromium } from 'playwright';

// Same-origin pages only, capped by count (not depth) — simplest bound on
// crawl cost/time regardless of how the site's link graph is shaped. Large
// dashboards/panels with deep sidebars need a bigger budget than a typical
// marketing site, hence the higher default vs. the old 10. Only pages that
// actually get NAVIGATED to (a cache miss, see extractFromUrl's
// previousPages) count against this — cache hits are free.
const MAX_CRAWL_PAGES = Number(process.env.URL_CRAWL_MAX_PAGES || 40);

// Secondary safety cap on total URLs processed (cache hits + real fetches)
// per crawl run — with a large previousPages cache, MAX_CRAWL_PAGES alone
// no longer bounds the BFS loop's total work, so this guards against a
// pathological link graph (e.g. query-string variations that dodge
// normalizeUrl's hash-only dedup) looping over an unbounded number of
// "already known" URLs.
const MAX_TOTAL_VISITED = MAX_CRAWL_PAGES * 20;

// Bound on how many collapsed-nav toggles we click per page — a large panel
// can have dozens of accordion sections; this keeps a single page's expand
// pass from running away.
const MAX_EXPAND_CLICKS = Number(process.env.URL_CRAWL_MAX_EXPAND_CLICKS || 25);

// waitForStableContent(): how long to poll for the page's text to stop
// growing before giving up and extracting whatever's there. Bounded (unlike
// 'networkidle', see extractPage's comment) so a page with a live
// connection (polling/websockets) that never truly settles still gets
// extracted after this ceiling instead of hanging.
const CONTENT_STABLE_POLL_MS = 500;
const CONTENT_STABLE_CHECKS = 2;
const CONTENT_MAX_WAIT_MS = Number(process.env.URL_CRAWL_MAX_WAIT_MS || 8000);

// Below this many extracted characters, a page is suspicious enough to log
// — most likely still on a loading/splash screen rather than genuinely
// content-free (see waitForStableContent's docstring for the motivating
// case: a multi-second boot-animation intro screen).
const MIN_CONTENT_CHARS = Number(process.env.URL_CRAWL_MIN_CONTENT_CHARS || 200);

// discoverClientRoutedLinks(): bound on how many nav/header buttons get
// click-tested per page — most sites have a handful of top-level nav items,
// this just guards against a pathological page with dozens of matches.
const MAX_NAV_DISCOVERY_CLICKS = Number(process.env.URL_CRAWL_MAX_NAV_CLICKS || 20);
// A candidate's visible text has to be this short to be considered a nav
// item (vs. a paragraph-length CTA button that happens to sit in a header).
const NAV_DISCOVERY_MAX_TEXT_CHARS = 40;
// Text matching this is skipped even if it's short and in a nav/header
// region — these are actions (lead-gen forms, auth, external redirects),
// not same-site navigation, and clicking them on an arbitrary customer's
// site risks a real side effect (a submitted form, a triggered call/chat
// widget, etc.) rather than just revealing a new page.
const NAV_DISCOVERY_ACTION_WORDS =
    /demo|talep|teklif|sipariş|satın|buy|purchase|order|sign\s*up|sign\s*in|kayıt\s*ol|giriş\s*yap|log\s*in|log\s*out|çıkış|gönder|submit|kaydet|\bsave\b|\bsil\b|delete|abone|subscribe|indir|download|iletişime\s*geç|contact\s*us|whatsapp|\bara\b|\bcall\b|paylaş|share/i;

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

/** Normalizes and same-origin-filters `rawLinks`, pushing unvisited ones onto `queue`. */
function enqueueLinks(rawLinks, queue, visited, rootOrigin) {
    for (const link of rawLinks) {
        const normalized = normalizeUrl(link);
        if (normalized && normalized.startsWith(rootOrigin) && !visited.has(normalized)) {
            queue.push(normalized);
        }
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
 * Polls `document.body.innerText`'s length until it stops growing (stable
 * for `CONTENT_STABLE_CHECKS` consecutive polls) or `CONTENT_MAX_WAIT_MS`
 * elapses, instead of a single fixed grace period after `domcontentloaded`.
 * A plain SPA typically stabilizes within 1-2 polls (faster than the old
 * fixed 3s wait); a page with a multi-second boot/splash animation (real
 * example found in testing: a ~4-5s fake-terminal intro screen before the
 * actual site content mounts) previously had its content captured
 * mid-animation — this waits for the real content to actually settle.
 * `'networkidle'` isn't used here (see extractPage's comment) because it
 * hangs on pages with a live connection open; polling text length with a
 * hard ceiling gets the same practical benefit without that hang risk.
 */
export async function waitForStableContent(page) {
    const start = Date.now();
    let lastLen = -1;
    let stableCount = 0;
    while (Date.now() - start < CONTENT_MAX_WAIT_MS) {
        const len = await page.evaluate(() => (document.body.innerText || '').length).catch(() => lastLen);
        if (len === lastLen) {
            stableCount++;
            if (stableCount >= CONTENT_STABLE_CHECKS) break;
        } else {
            stableCount = 0;
        }
        lastLen = len;
        await page.waitForTimeout(CONTENT_STABLE_POLL_MS);
    }
}

/**
 * Some sites render primary navigation as `<button>`/`[role=button]`
 * elements that push a new URL via `history.pushState` (client-side
 * routing) instead of real `<a href>` tags — confirmed in testing on a
 * real customer site where the nav had ZERO anchor elements, so
 * `document.querySelectorAll('a[href]')` found nothing and the crawl never
 * left the homepage. This click-tests short-text buttons scoped to
 * `<nav>`/`<header>` (where primary navigation lives) and records any URL
 * that a click actually navigates to, then returns to `originalUrl` before
 * trying the next candidate.
 *
 * Deliberately conservative, since this means clicking on an ARBITRARY
 * customer's site: only `<nav>`/`<header>` elements (excludes body/footer
 * CTAs), only short menu-item-length text (`NAV_DISCOVERY_MAX_TEXT_CHARS`),
 * and anything matching `NAV_DISCOVERY_ACTION_WORDS` (demo requests, forms,
 * auth, calls, downloads, sharing — actions with a real side effect) is
 * skipped outright. A click that doesn't change the URL (a dropdown toggle,
 * a modal, a no-op) is simply not recorded — nothing to undo since nothing
 * navigated.
 */
async function discoverClientRoutedLinks(page, rootOrigin) {
    const originalUrl = page.url();
    const discovered = new Set();
    const selector = 'nav button, header button, nav [role="button"], header [role="button"]';

    let candidates;
    try {
        candidates = await page.evaluate(
            (sel) => [...document.querySelectorAll(sel)].map((el) => (el.textContent || '').trim()),
            selector
        );
    } catch {
        return [];
    }

    let attempted = 0;
    for (let i = 0; i < candidates.length && attempted < MAX_NAV_DISCOVERY_CLICKS; i++) {
        const text = candidates[i];
        if (!text || text.length > NAV_DISCOVERY_MAX_TEXT_CHARS || NAV_DISCOVERY_ACTION_WORDS.test(text)) continue;
        attempted++;

        try {
            const handles = await page.$$(selector);
            const el = handles[i];
            if (!el) continue;
            await el.click({ timeout: 2000 });
            await page.waitForTimeout(300);
            const newUrl = page.url();
            if (newUrl !== originalUrl && newUrl.startsWith(rootOrigin)) {
                discovered.add(newUrl);
            }
        } catch {
            // not clickable (covered/detached/no-op handler) — harmless, skip
        }

        if (page.url() !== originalUrl) {
            try {
                await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 });
            } catch {
                await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            }
            // Cheap when already-stable (goBack for a client-routed SPA
            // doesn't replay a full boot animation) — only actually waits
            // when the restore genuinely triggered a fresh page load.
            await waitForStableContent(page);
        }
    }

    return [...discovered];
}

/**
 * Navigates to one page, returns its visible text plus every same-origin
 * link found on it — both real `<a href>` tags and, for sites with none
 * (see discoverClientRoutedLinks), client-side-routed nav buttons — after
 * expanding any collapsed nav sections. Returns `{ ok: false }` for 4xx/5xx
 * responses — a 404'd link shouldn't get its error-page boilerplate indexed
 * as product knowledge.
 */
async function extractPage(page, urlStr, rootOrigin) {
    // 'networkidle' hangs/crashes on SPAs that keep a live connection open
    // (polling, websockets, dashboards) — they never go idle. Wait for the
    // DOM instead, then let client-side rendering settle adaptively.
    const response = await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForStableContent(page);

    if (response && response.status() >= 400) {
        return { ok: false, status: response.status() };
    }

    await expandCollapsedNav(page);
    const clientRoutedLinks = await discoverClientRoutedLinks(page, rootOrigin);
    // discoverClientRoutedLinks() navigates away and back per candidate —
    // restore any nav expansion state lost in that round-trip before the
    // final scrape below.
    await expandCollapsedNav(page);

    const { text, links } = await page.evaluate(() => {
        document.querySelectorAll('script, style, noscript, iframe, link, meta').forEach((el) => el.remove());
        const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
        return { text: document.body.innerText || document.body.textContent || '', links };
    });
    links.push(...clientRoutedLinks);

    // Line breaks are kept (not flattened to one line here) — they're what
    // stripRepeatedBoilerplate() below diffs across pages to find repeated
    // nav/header chrome; each individually-blank/whitespace line is dropped
    // but line boundaries themselves survive until after that pass runs.
    const lines = text
        .split(/\r\n?|\n/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const joined = lines.join('\n');

    if (joined.length < MIN_CONTENT_CHARS) {
        console.warn('[url-extractor] şüpheli derecede az içerik çıkarıldı (sayfa hâlâ yükleniyor/gizli olabilir):', {
            url: urlStr,
            length: joined.length
        });
    }

    return { ok: true, text: joined, links };
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
 * `URL_CRAWL_MAX_PAGES` NEWLY-fetched pages (BFS, one shared authenticated
 * browser context). Returns both the combined text with a `[Page: <url>]`
 * marker per page (`text` — kept for `meta.extractedText`/backfill,
 * human-scannable as a single blob), the raw per-page breakdown (`pages` —
 * what `handleIngestSource()` uses to chunk each page separately and tag
 * its chunks with `metadata.pageUrl`), and `pagesIndex` (`{[url]: {rawText,
 * links}}` for every page in this run, reused or freshly fetched — the
 * caller persists this as `KnowledgeSource.meta.crawlIndex.pages` so the
 * *next* ingestion of this source can pass it back in as `previousPages`).
 *
 * @param {string} urlStr
 * @param {{loginUrl?:string, email:string, password:string, selectors?:{email?:string,password?:string,submit?:string}}|null} [auth] -
 *   Same shape as the guided tour's demo-session auth (see `@repo/screen`'s
 *   `loginWithCredentials`) — logs in via the product's own login form before
 *   crawling. Without it, auth-gated pages are scraped anonymously and only
 *   the public/login view gets indexed.
 * @param {(current:number, max:number) => void} [onProgress]
 * @param {Map<string, {rawText:string, links:string[]}>} [previousPages] -
 *   URLs already crawled/chunked in a prior ingestion of this same source.
 *   Such a URL is NOT re-navigated — its cached text/links are reused
 *   as-is and it doesn't count against `MAX_CRAWL_PAGES`, so the budget of
 *   real page loads goes entirely to URLs not yet indexed (e.g. pages only
 *   reachable after a login that wasn't configured on the first crawl).
 *   Known trade-off: a reused page's content is never refreshed by this
 *   mechanism even if the live site changed — only a `websiteUrl` change
 *   (a different root/crawl) or a manually forced full re-crawl would pick
 *   that up. Defaults to an empty Map (first-ever crawl of a source).
 * @returns {Promise<{ text: string, pages: { url: string, text: string }[], pagesIndex: Record<string, {rawText:string, links:string[]}> }>}
 */
export async function extractFromUrl(urlStr, auth = null, onProgress = null, previousPages = new Map()) {
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
        const pagesIndex = {};
        let fetchedCount = 0;

        while (queue.length && fetchedCount < MAX_CRAWL_PAGES && visited.size < MAX_TOTAL_VISITED) {
            const next = queue.shift();
            if (!next || visited.has(next)) continue;
            visited.add(next);

            const cached = previousPages.get(next);
            if (cached) {
                // Already crawled/chunked in a prior run of this source —
                // reuse its text/links without a real page load, and don't
                // spend this run's MAX_CRAWL_PAGES budget on it.
                pages.push({ url: next, text: cached.rawText });
                pagesIndex[next] = cached;
                enqueueLinks(cached.links, queue, visited, rootOrigin);
                continue;
            }

            if (next !== rootUrl) {
                try {
                    await checkSSRFUrl(next);
                } catch {
                    continue; // unsafe/unreachable link — skip it, don't abort the crawl
                }
            }

            let result;
            try {
                result = await extractPage(page, next, rootOrigin);
            } catch {
                continue; // one broken page shouldn't kill the whole crawl
            }
            fetchedCount++;
            onProgress?.(fetchedCount, MAX_CRAWL_PAGES);

            // 404/5xx — don't index the error page, and it has no real links
            // to follow (its "not found" boilerplate isn't a route map).
            if (!result.ok) continue;

            pages.push({ url: next, text: result.text });
            pagesIndex[next] = { rawText: result.text, links: result.links };
            enqueueLinks(result.links, queue, visited, rootOrigin);
        }

        const cleanedPages = stripRepeatedBoilerplate(pages);
        return {
            text: cleanedPages.map((p) => `[Page: ${p.url}]\n${p.text}`).join('\n\n'),
            pages: cleanedPages,
            pagesIndex
        };
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}
