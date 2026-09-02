import { checkSSRFUrl, waitForStableContent as waitForStableContentShared } from '@repo/utils';
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

// discoverTabVariants(): bound on how many candidate tab/panel labels get
// click-tested per page — a full page reload + click per candidate is
// expensive (see discoverTabVariants' own docstring), this just guards
// against a pathological page with a huge sibling-button group.
const MAX_TAB_DISCOVERY_CLICKS = Number(process.env.URL_CRAWL_MAX_TAB_CLICKS || 8);
// Below this many sibling candidates, it's not a meaningful "tab group"
// signal — a single button next to unrelated content would otherwise be
// mistaken for one.
const TAB_GROUP_MIN_MEMBERS = 2;

// Component-level page inventory caps (headings/interactiveElements/sections,
// see extractPage's evaluate() below) — this is a pure DOM read (nothing is
// clicked, unlike discoverClientRoutedLinks above), so there's no
// action-word/side-effect concern here, only a size bound so a very dense
// page doesn't bloat the persisted crawlIndex/site map unboundedly.
const MAX_HEADINGS_PER_PAGE = 30;
const MAX_INTERACTIVE_ELEMENTS_PER_PAGE = 60;
const MAX_SECTIONS_PER_PAGE = 20;
const INTERACTIVE_ELEMENT_MAX_TEXT_CHARS = 80;
const SECTION_SNIPPET_CHARS = 150;

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

/** Normalizes and same-origin-filters `rawLinks`, pushing unvisited ones onto `queue`.
 * `rawLinks` entries are either a plain URL string (legacy cache shape, see
 * `previousPages`) or `{targetUrl, label?, kind?}` (current crawl shape, see
 * `extractPage`/`discoverClientRoutedLinks`) — both are accepted so a source
 * crawled before the site-structure-tree fields existed still dequeues fine.
 * `parentUrl` (the page `rawLinks` was found on) is carried onto each queued
 * item so `pagesIndex` can record the crawl-tree parent once the link is
 * actually visited (see `extractFromUrl`'s main loop). */
function enqueueLinks(rawLinks, queue, visited, rootOrigin, parentUrl) {
    for (const link of rawLinks) {
        const targetUrl = typeof link === 'string' ? link : link?.targetUrl;
        const normalized = normalizeUrl(targetUrl);
        if (normalized && normalized.startsWith(rootOrigin) && !visited.has(normalized)) {
            queue.push({ url: normalized, parentUrl });
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
 * Thin wrapper over `@repo/utils`'s `waitForStableContent()` (see its
 * docstring for the full rationale — a real customer site's ~4-5s
 * fake-terminal boot animation, previously captured mid-animation by a
 * fixed 3s wait) that applies this crawler's own env-configurable ceiling
 * (`URL_CRAWL_MAX_WAIT_MS`) and poll/stable-check constants. Kept as a
 * named export here (not just re-exported bare) so existing callers/tests
 * in this file don't need to pass those options through every call site.
 */
export function waitForStableContent(page) {
    return waitForStableContentShared(page, {
        pollMs: CONTENT_STABLE_POLL_MS,
        stableChecks: CONTENT_STABLE_CHECKS,
        maxWaitMs: CONTENT_MAX_WAIT_MS
    });
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
    // Keyed by targetUrl (not a Set of bare strings) so two differently-
    // labelled buttons landing on the same URL don't produce duplicate
    // structure-tree edges. Entries carry the button's own text as `label`
    // (site-structure-tree's only signal for a client-routed nav item's
    // name — there's no `<a href>`/title to fall back on).
    const discovered = new Map();
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
            if (newUrl !== originalUrl && newUrl.startsWith(rootOrigin) && !discovered.has(newUrl)) {
                discovered.set(newUrl, { label: text, targetUrl: newUrl, kind: 'button' });
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

    return [...discovered.values()];
}

/**
 * Reads (never clicks) a structural inventory of the page: heading
 * hierarchy, every meaningfully-labeled interactive element site-wide (not
 * just nav/header — see discoverClientRoutedLinks for why that pass is
 * scoped tighter), and notable landmark sections (forms, `<section>`,
 * `aria-label`'d blocks). This is what lets `find_element`
 * (packages/agent/src/tools.js) hand the model a real selector instead of it
 * guessing one for `click_element`/`highlight`.
 *
 * `selector` for interactive elements is a plain `text=<label>` locator —
 * not a generated CSS path — because that's exactly what `GuidedTour.click()`/
 * `.highlight()` (packages/screen/src/cobrowse.js) already expect and have
 * tests exercising (see cobrowse.test.js's `text=Ürünler` cases), so no new
 * selector scheme is introduced.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{headings:{level:number,text:string}[], interactiveElements:{label:string,kind:'button'|'link'|'submit',selector:string}[], sections:{tag:string,ariaLabel:string|null,textSnippet:string}[]}>}
 */
export async function extractPageComponents(page) {
    try {
        return await page.evaluate(
            ({ maxHeadings, maxInteractive, maxSections, maxTextChars, snippetChars }) => {
                const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
                    .map((el) => ({ level: Number(el.tagName[1]), text: (el.textContent || '').trim() }))
                    .filter((h) => h.text)
                    .slice(0, maxHeadings);

                const interactiveElements = [];
                const seenLabels = new Set();
                for (const el of document.querySelectorAll(
                    'button, a[href], [role="button"], input[type="submit"], button[type="submit"]'
                )) {
                    if (interactiveElements.length >= maxInteractive) break;
                    const label = (el.textContent || el.value || '').trim();
                    if (!label || label.length > maxTextChars || seenLabels.has(label)) continue;
                    seenLabels.add(label);
                    const tag = el.tagName.toLowerCase();
                    const kind =
                        el.matches('input[type="submit"], button[type="submit"]')
                            ? 'submit'
                            : tag === 'a'
                              ? 'link'
                              : 'button';
                    interactiveElements.push({ label, kind, selector: `text=${label}` });
                }

                const sections = [...document.querySelectorAll('form, section, [aria-label]')]
                    .map((el) => ({
                        tag: el.tagName.toLowerCase(),
                        ariaLabel: el.getAttribute('aria-label') || null,
                        textSnippet: (el.textContent || '').trim().slice(0, snippetChars)
                    }))
                    .filter((s) => s.ariaLabel || s.textSnippet)
                    .slice(0, maxSections);

                return { headings, interactiveElements, sections };
            },
            {
                maxHeadings: MAX_HEADINGS_PER_PAGE,
                maxInteractive: MAX_INTERACTIVE_ELEMENTS_PER_PAGE,
                maxSections: MAX_SECTIONS_PER_PAGE,
                maxTextChars: INTERACTIVE_ELEMENT_MAX_TEXT_CHARS,
                snippetChars: SECTION_SNIPPET_CHARS
            }
        );
    } catch {
        return { headings: [], interactiveElements: [], sections: [] };
    }
}

/**
 * Finds the largest group of short-text buttons/`[role=button]` elements
 * that share a DOM parent and sit OUTSIDE `<nav>`/`<header>` (those are
 * `discoverClientRoutedLinks`' territory — real page-to-page navigation;
 * this is the opposite case: same-page product/tab selectors). Read-only,
 * nothing is clicked here — cheap to run on every page.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>} candidate labels from the single largest sibling group
 */
async function detectTabGroupLabels(page) {
    try {
        return await page.evaluate(
            ({ maxTextChars }) => {
                const candidates = [...document.querySelectorAll('button, [role="button"]')].filter(
                    (el) => !el.closest('nav, header')
                );
                const groups = new Map();
                for (const el of candidates) {
                    const text = (el.textContent || '').trim();
                    if (!text || text.length > maxTextChars) continue;
                    const parent = el.parentElement;
                    if (!parent) continue;
                    if (!groups.has(parent)) groups.set(parent, []);
                    groups.get(parent).push(text);
                }
                let best = [];
                for (const labels of groups.values()) {
                    if (labels.length > best.length) best = labels;
                }
                return best;
            },
            { maxTextChars: NAV_DISCOVERY_MAX_TEXT_CHARS }
        );
    } catch {
        return [];
    }
}

/** Same script/style-stripping + heading extraction as extractPage's final
 * scrape, reused so a tab-variant snapshot is captured identically. */
async function extractTabPanelSnapshot(page) {
    try {
        return await page.evaluate((maxHeadings) => {
            document.querySelectorAll('script, style, noscript, iframe, link, meta').forEach((el) => el.remove());
            const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
                .map((el) => ({ level: Number(el.tagName[1]), text: (el.textContent || '').trim() }))
                .filter((h) => h.text)
                .slice(0, maxHeadings);
            const rawText = document.body.innerText || document.body.textContent || '';
            return { headings, rawText };
        }, MAX_HEADINGS_PER_PAGE);
    } catch {
        return { headings: [], rawText: '' };
    }
}

/**
 * Some pages (confirmed on a real customer site's "solutions" page) render
 * several product/topic panels behind a row of buttons that swap the SAME
 * page's content without changing the URL — the exact opposite signal from
 * `discoverClientRoutedLinks` (which looks for a click that DOES change the
 * URL). A plain crawl only ever captures whichever panel happens to be
 * showing at load time (confirmed: 3 separate real crawls of the same page
 * each captured a different panel), leaving every other panel's content
 * completely unindexed.
 *
 * For each candidate label (from `detectTabGroupLabels`, filtered here
 * against the same `NAV_DISCOVERY_ACTION_WORDS` safety list
 * `discoverClientRoutedLinks` uses — never risk clicking a CTA with a real
 * side effect), this does a full fresh reload of `urlStr` before clicking —
 * deliberately not just clicking through panels in sequence — so one
 * candidate's state can never bleed into the next one's snapshot.
 *
 * @param {import('playwright').Page} page
 * @param {string} urlStr
 * @returns {Promise<{label:string, headings:{level:number,text:string}[], rawText:string}[]>}
 */
export async function discoverTabVariants(page, urlStr) {
    // Real-site testing found the page can arrive here in a state
    // `detectTabGroupLabels` can't read correctly — e.g. right after
    // discoverClientRoutedLinks()'s goBack()-based restore, which doesn't
    // reproduce a fresh page.goto()'s hydration exactly and made a real
    // 7-item tab bar invisible to the DOM query below. A clean reload here
    // guarantees the same page state the per-candidate clicks below use.
    await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForStableContent(page);

    const rawLabels = [...new Set(await detectTabGroupLabels(page))];
    // The group-size check runs on the RAW group (a CTA sitting inside an
    // otherwise-real tab row still counts toward "this looks like a tab
    // group") — action words are filtered afterward, only to decide what's
    // actually safe to click.
    if (rawLabels.length < TAB_GROUP_MIN_MEMBERS) return [];
    const labels = rawLabels.filter((text) => !NAV_DISCOVERY_ACTION_WORDS.test(text));

    const variants = [];
    for (const label of labels.slice(0, MAX_TAB_DISCOVERY_CLICKS)) {
        try {
            await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await waitForStableContent(page);
            await page.click(`text=${label}`, { timeout: 2000 });
            await waitForStableContent(page);
            const { headings, rawText } = await extractTabPanelSnapshot(page);
            variants.push({ label, headings, rawText });
        } catch {
            // candidate not clickable, or page didn't settle — skip it, harmless
        }
    }
    return variants;
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
    const components = await extractPageComponents(page);

    const { text, links } = await page.evaluate(() => {
        document.querySelectorAll('script, style, noscript, iframe, link, meta').forEach((el) => el.remove());
        // {label, targetUrl, kind} — not bare hrefs — so the site-structure
        // tree (persisted by handleIngestSource() into meta.crawlIndex.pages)
        // can show what a link is actually called, not just where it goes.
        const links = [...document.querySelectorAll('a[href]')].map((a) => ({
            label: (a.textContent || '').trim().slice(0, 80),
            targetUrl: a.href,
            kind: 'link'
        }));
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

    // Runs last — it reloads/navigates the page repeatedly and nothing
    // below this point needs the current page state to match `urlStr`.
    const tabVariants = await discoverTabVariants(page, urlStr);

    return { ok: true, text: joined, links, components, ...(tabVariants.length ? { tabVariants } : {}) };
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
 * links, parentUrl}}` for every page in this run, reused or freshly fetched —
 * the caller persists this as `KnowledgeSource.meta.crawlIndex.pages` so the
 * *next* ingestion of this source can pass it back in as `previousPages`, AND
 * so it can be rendered as the site-structure tree — `parentUrl` is the page
 * this one was discovered from (`null` for the root), and each `links` entry
 * is `{label, targetUrl, kind:'link'|'button'}` (a real `<a href>` vs. a
 * client-routed nav button, see `discoverClientRoutedLinks`) rather than a
 * bare URL, so a customer-facing sitemap view can show what a link is
 * actually called, not just where it points). Each `pagesIndex` entry also
 * carries `components` — the page's heading/interactive-element/section
 * inventory (see `extractPageComponents`), absent (`undefined`) on entries
 * reused from a `previousPages` cache predating this field. Entries for a
 * page with a same-page tab/panel selector (see `discoverTabVariants`) also
 * carry `tabVariants` — `{label, headings, rawText}` per panel, absent when
 * the page has none. Only ever populated on a freshly-fetched page, never
 * on a `previousPages` cache hit, same rule as `components`.
 *
 * @param {string} urlStr
 * @param {{loginUrl?:string, email:string, password:string, selectors?:{email?:string,password?:string,submit?:string}}|null} [auth] -
 *   Same shape as the guided tour's demo-session auth (see `@repo/screen`'s
 *   `loginWithCredentials`) — logs in via the product's own login form before
 *   crawling. Without it, auth-gated pages are scraped anonymously and only
 *   the public/login view gets indexed.
 * @param {(current:number, max:number) => void} [onProgress]
 * @param {Map<string, {rawText:string, links:(string|{targetUrl:string,label?:string,kind?:string})[], parentUrl?:string|null, components?:object}>} [previousPages] -
 *   URLs already crawled/chunked in a prior ingestion of this same source.
 *   Such a URL is NOT re-navigated — its cached text/links are reused
 *   as-is and it doesn't count against `MAX_CRAWL_PAGES`, so the budget of
 *   real page loads goes entirely to URLs not yet indexed (e.g. pages only
 *   reachable after a login that wasn't configured on the first crawl).
 *   `links` entries may be plain URL strings (a source crawled before the
 *   `{label,targetUrl,kind}` shape existed) — `enqueueLinks` accepts both.
 *   Known trade-off: a reused page's content is never refreshed by this
 *   mechanism even if the live site changed — only a `websiteUrl` change
 *   (a different root/crawl) or a manually forced full re-crawl would pick
 *   that up. Defaults to an empty Map (first-ever crawl of a source).
 * @returns {Promise<{ text: string, pages: { url: string, text: string }[], pagesIndex: Record<string, {rawText:string, links:{label:string,targetUrl:string,kind:string}[], parentUrl:string|null, components:{headings:object[], interactiveElements:object[], sections:object[]}}> }>}
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
        // Queue items carry {url, parentUrl} (not bare URLs) so the
        // site-structure tree can record which page a freshly-fetched page
        // was discovered from — see pagesIndex's `parentUrl` below.
        const queue = [{ url: rootUrl, parentUrl: null }];
        const pages = [];
        const pagesIndex = {};
        let fetchedCount = 0;

        while (queue.length && fetchedCount < MAX_CRAWL_PAGES && visited.size < MAX_TOTAL_VISITED) {
            const { url: next, parentUrl } = queue.shift();
            if (!next || visited.has(next)) continue;
            visited.add(next);

            const cached = previousPages.get(next);
            if (cached) {
                // Already crawled/chunked in a prior run of this source —
                // reuse its text/links (and parentUrl, if the cache predates
                // that field, it's simply absent — degrades to an unparented
                // structure-tree node, not an error) without a real page
                // load, and don't spend this run's MAX_CRAWL_PAGES budget on it.
                pages.push({ url: next, text: cached.rawText });
                pagesIndex[next] = cached;
                enqueueLinks(cached.links, queue, visited, rootOrigin, next);
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
            pagesIndex[next] = {
                rawText: result.text,
                links: result.links,
                parentUrl,
                components: result.components,
                ...(result.tabVariants ? { tabVariants: result.tabVariants } : {})
            };
            enqueueLinks(result.links, queue, visited, rootOrigin, next);
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
