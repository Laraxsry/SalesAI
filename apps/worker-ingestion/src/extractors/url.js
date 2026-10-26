import { checkSSRFUrl, safeFetch, waitForStableContent as waitForStableContentShared } from '@repo/utils';
import { loginWithCredentials } from '@repo/screen';
import { extractDocumentText } from '@repo/rag';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { ACTION_WORDS as NAV_DISCOVERY_ACTION_WORDS, MAX_LABEL_CHARS as NAV_DISCOVERY_MAX_TEXT_CHARS } from './click-safety.js';
import { discoverClientRoutedLinks } from './nav-discovery.js';
import { peekAtButtons } from './state-discovery.js';
import { annotateElements } from './ui-guide.js';

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

// Discovered PDF links are downloaded and parsed instead of Playwright-
// navigated (see extractPdfPage). Streamed and enforced against the actual
// byte count as it arrives — a Content-Length header can be absent or lie,
// so it's only used as an early reject, never trusted on its own. Slightly
// tighter than ZIP_MAX_ENTRY_BYTES (ingest-source.js) since that cap applies
// to a locally-trusted uploaded archive, not bytes fetched from an arbitrary
// link discovered on a crawled site.
const MAX_PDF_BYTES = Number(process.env.URL_CRAWL_MAX_PDF_BYTES || 20 * 1024 * 1024);

// waitForStableContent(): how long to poll for the page's text to stop
// growing before giving up and extracting whatever's there. Bounded (unlike
// 'networkidle', see extractPage's comment) so a page with a live
// connection (polling/websockets) that never truly settles still gets
// extracted after this ceiling instead of hanging.
const CONTENT_STABLE_POLL_MS = 500;
const CONTENT_STABLE_CHECKS = 2;
const CONTENT_MAX_WAIT_MS = Number(process.env.URL_CRAWL_MAX_WAIT_MS || 8000);

// A cold first load of a client-rendered app (big JS bundles, a logged-in
// panel) can stay blank or on a skeleton longer than CONTENT_MAX_WAIT_MS; the
// reload that tab discovery does later hits the warm cache and renders fast,
// so the first read alone would come back empty. Only a first load that is
// still below MIN_CONTENT_CHARS earns this extra patience, so ordinary pages
// stay fast.
const SLOW_PAGE_EXTRA_WAIT_MS = Number(process.env.URL_CRAWL_SLOW_PAGE_WAIT_MS || 20000);

// Below this many extracted characters, a page is suspicious enough to log
// — most likely still on a loading/splash screen rather than genuinely
// content-free (see waitForStableContent's docstring for the motivating
// case: a multi-second boot-animation intro screen).
const MIN_CONTENT_CHARS = Number(process.env.URL_CRAWL_MIN_CONTENT_CHARS || 200);

// discoverTabVariants(): bound on how many candidate tab/panel labels get
// click-tested per page — a full page reload + click per candidate is
// expensive (see discoverTabVariants' own docstring), this just guards
// against a pathological page with a huge sibling-button group.
const MAX_TAB_DISCOVERY_CLICKS = Number(process.env.URL_CRAWL_MAX_TAB_CLICKS || 8);
const MAX_TOGGLE_DISCOVERY_CLICKS = Number(process.env.URL_CRAWL_MAX_TOGGLE_CLICKS || 20);
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
const MAX_INTERACTIVE_ELEMENTS_PER_PAGE = Number(process.env.URL_CRAWL_MAX_INTERACTIVE || 250);
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

// Bump when persisted page-index semantics change. Cache entries without
// this version are deliberately fetched once more so newly introduced
// element discovery is not permanently absent from older knowledge sources.
const CRAWL_PAGE_INDEX_VERSION = 3;

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
const PDF_URL_PATTERN = /\.pdf(?:[?#]|$)/i;

function enqueueLinks(rawLinks, queue, visited, rootOrigin, parentUrl) {
    for (const link of rawLinks) {
        const targetUrl = typeof link === 'string' ? link : link?.targetUrl;
        const normalized = normalizeUrl(targetUrl);
        if (normalized && normalized.startsWith(rootOrigin) && !visited.has(normalized)) {
            const isPdfCandidate = PDF_URL_PATTERN.test(new URL(normalized).pathname);
            queue.push({ url: normalized, parentUrl, ...(isPdfCandidate ? { isPdfCandidate: true } : {}) });
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
        // Navigation expansion is deliberately scoped away from ordinary
        // page content. FAQ/accordion toggles are discovered independently
        // by discoverToggleVariants(), which snapshots and restores each one.
        const toggle = page.locator(
            'nav [aria-expanded="false"], header [aria-expanded="false"], [role="navigation"] [aria-expanded="false"], aside [aria-expanded="false"]'
        ).first();
        if ((await toggle.count()) === 0) break;
        try {
            await toggle.click({ timeout: 2000 });
            await page.waitForTimeout(250);
        } catch {
            break; // not clickable (covered/detached) — stop rather than retry forever
        }
    }
}

function slugPart(value, fallback) {
    const slug = String(value || '')
        .replace(/[ıİ]/g, 'i')
        .replace(/[şŞ]/g, 's')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[üÜ]/g, 'u')
        .replace(/[öÖ]/g, 'o')
        .replace(/[çÇ]/g, 'c')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    return slug || fallback;
}

function buildElementIdentity(pageUrl, sectionLabel, label, duplicateIndex = 0, kind = 'toggle') {
    const basePath = `${slugPart(sectionLabel, 'page')}/${slugPart(label, kind)}`;
    const elementPath = duplicateIndex > 0 ? `${basePath}--${duplicateIndex + 1}` : basePath;
    const digest = createHash('sha256')
        .update(`${normalizeUrl(pageUrl) || pageUrl}|${kind}|${label}|${duplicateIndex}`)
        .digest('hex')
        .slice(0, 16);
    return { elementKey: `el_${digest}`, elementPath };
}

function ensureUniqueElementKeys(pageUrl, components) {
    if (!components) return components;
    const rekey = (elements = []) => {
        const duplicateCounts = new Map();
        return elements.map((element) => {
            const identity = `${element.kind || 'button'}|${element.selector || ''}|${element.label || ''}`;
            const duplicateIndex = duplicateCounts.get(identity) || 0;
            duplicateCounts.set(identity, duplicateIndex + 1);
            return {
                ...element,
                ...buildElementIdentity(pageUrl, element.kind, identity, duplicateIndex, element.kind)
            };
        });
    };
    return {
        ...components,
        interactiveElements: rekey(components.interactiveElements),
        ...(components.toggles ? { toggles: rekey(components.toggles) } : {})
    };
}

/**
 * Discovers expandable, non-navigation content without flattening it into the
 * page-level component lists. Each toggle is snapshotted independently and
 * restored to its initial state, so single-open accordions retain every answer
 * and the base page scrape remains representative of its normal visible state.
 */
export async function discoverToggleVariants(page, pageUrl) {
    let candidates;
    try {
        candidates = await page.evaluate(
            ({ maxTextChars }) => [...document.querySelectorAll('[aria-expanded]')]
                .filter((el) => !el.closest('nav, header, aside'))
                .map((el, index) => {
                    const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
                    const controlsId = el.getAttribute('aria-controls') || null;
                    const section = el.closest('section, main, [aria-label]');
                    const sectionLabel = section?.getAttribute('aria-label') ||
                        section?.querySelector?.('h1, h2, h3, h4, h5, h6')?.textContent?.trim() ||
                        null;
                    return {
                        index,
                        label,
                        controlsId,
                        sectionLabel,
                        initialExpanded: el.getAttribute('aria-expanded') === 'true'
                    };
                })
                .filter((item) => item.label && item.label.length <= maxTextChars),
            { maxTextChars: INTERACTIVE_ELEMENT_MAX_TEXT_CHARS }
        );
    } catch {
        return [];
    }
    if (!Array.isArray(candidates)) return [];

    const safeCandidates = candidates
        .filter((item) => !NAV_DISCOVERY_ACTION_WORDS.test(item.label))
        .slice(0, MAX_TOGGLE_DISCOVERY_CLICKS);
    const duplicateCounts = new Map();
    const variants = [];

    for (const candidate of safeCandidates) {
        const selector = candidate.controlsId
            ? `[aria-controls=${JSON.stringify(candidate.controlsId)}]`
            : `text=${candidate.label}`;
        const locator = page.locator(selector).first();
        try {
            await locator.waitFor({ state: 'visible', timeout: 2000 });
            if (!candidate.initialExpanded) {
                await locator.click({ timeout: 2000 });
                await waitForStableContent(page);
            }
            const snapshot = await locator.evaluate((el) => {
                const controlsId = el.getAttribute('aria-controls');
                const controlled = controlsId ? el.ownerDocument?.getElementById(controlsId) : null;
                const container = controlled || el.closest('details, section, article, li, div') || el.parentElement;
                return {
                    expanded: el.getAttribute('aria-expanded') === 'true',
                    revealedText: (controlled?.innerText || container?.innerText || '').trim().slice(0, 4000)
                };
            });

            const basePath = `${slugPart(candidate.sectionLabel, 'page')}/${slugPart(candidate.label, 'toggle')}`;
            const duplicateIndex = duplicateCounts.get(basePath) || 0;
            duplicateCounts.set(basePath, duplicateIndex + 1);
            const identity = buildElementIdentity(pageUrl, candidate.sectionLabel, candidate.label, duplicateIndex);
            variants.push({
                ...identity,
                label: candidate.label,
                selector,
                controlsId: candidate.controlsId,
                sectionLabel: candidate.sectionLabel,
                kind: 'toggle',
                expanded: snapshot?.expanded === true,
                revealedText: snapshot?.revealedText || ''
            });

            if (!candidate.initialExpanded && snapshot?.expanded === true) {
                await locator.click({ timeout: 2000 });
            }
        } catch {
            // A detached or animated toggle is an expected crawl miss. Keep
            // crawling the rest of the page instead of failing the source.
        }
    }
    return variants;
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
 * Waits for a freshly navigated page to render. Same quick stability wait as
 * every other step; when the page is still below `MIN_CONTENT_CHARS` after
 * that (blank body or a loading skeleton), waits once more, up to
 * `extraWaitMs`, for real content before the caller reads links/elements.
 * Nothing is thrown for a page that stays sparse — the caller's existing
 * "suspiciously little content" warning covers it.
 */
export async function waitForInitialRender(page, { extraWaitMs = SLOW_PAGE_EXTRA_WAIT_MS } = {}) {
    await waitForStableContent(page);
    const length = await page
        .evaluate(() => (document.body.innerText || '').length)
        .catch(() => 0);
    if (length >= MIN_CONTENT_CHARS) return;
    await waitForStableContentShared(page, {
        pollMs: CONTENT_STABLE_POLL_MS,
        stableChecks: CONTENT_STABLE_CHECKS,
        maxWaitMs: extraWaitMs,
        minChars: MIN_CONTENT_CHARS
    });
}

/**
 * Reads (never clicks) a structural inventory of the page: heading
 * hierarchy, every meaningfully-labeled interactive element site-wide (not
 * just navigation regions — nav-discovery.js clicks only those, and only
 * after click-safety.js approves the label), and notable landmark sections (forms, `<section>`,
 * `aria-label`'d blocks). This is what lets `find_element`
 * (packages/agent/src/tools.js) hand the model a real selector instead of it
 * guessing one for `click_element`/`highlight`.
 *
 * Every interactive element receives a deterministic elementKey and a
 * selector that matched exactly once during the crawl. Stable attributes
 * (`id`, test id, aria-label, name) win; a structural CSS path is the fallback.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{headings:{level:number,text:string}[], interactiveElements:{elementKey:string,elementPath:string,label:string,kind:string,selector:string}[], sections:{tag:string,ariaLabel:string|null,textSnippet:string}[]}>}
 */
export async function extractPageComponents(page, pageUrl = page.url?.() || 'unknown') {
    try {
        const components = await page.evaluate(
            ({ maxHeadings, maxInteractive, maxSections, maxTextChars, snippetChars }) => {
                const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
                    .map((el) => ({ level: Number(el.tagName[1]), text: (el.textContent || '').trim() }))
                    .filter((h) => h.text)
                    .slice(0, maxHeadings);

                const interactiveElements = [];
                const escapeAttribute = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                const uniqueSelector = (el, label) => {
                    const id = el.id || el.getAttribute('id');
                    if (id) {
                        const selector = `#${globalThis.CSS?.escape ? CSS.escape(id) : id}`;
                        if (document.querySelectorAll(selector).length === 1) return selector;
                    }
                    for (const attr of ['data-testid', 'data-test', 'data-cy', 'aria-label', 'name']) {
                        const value = el.getAttribute(attr);
                        if (!value) continue;
                        const selector = `[${attr}="${escapeAttribute(value)}"]`;
                        if (document.querySelectorAll(selector).length === 1) return selector;
                    }
                    if (!el.parentElement) return `text=${label}`;
                    const path = [];
                    let node = el;
                    while (node?.tagName && node !== document.body) {
                        const tag = node.tagName.toLowerCase();
                        const siblings = node.parentElement
                            ? [...node.parentElement.children].filter((sibling) => sibling.tagName === node.tagName)
                            : [];
                        path.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
                        const selector = path.join(' > ');
                        if (document.querySelectorAll(selector).length === 1) return selector;
                        node = node.parentElement;
                    }
                    return path.length ? path.join(' > ') : `text=${label}`;
                };
                for (const el of document.querySelectorAll(
                    'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], summary, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"]'
                )) {
                    if (interactiveElements.length >= maxInteractive) break;
                    const label = (
                        el.getAttribute('aria-label') ||
                        el.getAttribute('title') ||
                        el.textContent ||
                        el.value ||
                        el.getAttribute('alt') ||
                        el.getAttribute('placeholder') ||
                        ''
                    ).trim();
                    if (!label || label.length > maxTextChars) continue;
                    const tag = el.tagName.toLowerCase();
                    const kind =
                        el.matches('input[type="submit"], button[type="submit"]')
                            ? 'submit'
                            : tag === 'a'
                              ? 'link'
                              : (el.getAttribute('role') || (tag === 'summary' ? 'toggle' : 'button'));
                    const selector = uniqueSelector(el, label);
                    // Every way this element can be found again, most durable first. A label changes ("Save" →
                    // "Kaydet") and a generated class or an nth-of-type path changes with the layout, so the
                    // selector is the last resort, not the only one.
                    const locators = [];
                    const addLocator = (locator) => {
                        if (!locators.some((known) => known.by === locator.by && known.value === locator.value && known.name === locator.name)) {
                            locators.push(locator);
                        }
                    };
                    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
                        if (el.getAttribute(attr)) addLocator({ by: 'attr', name: attr, value: el.getAttribute(attr) });
                    }
                    for (const attribute of el.attributes || []) {
                        if (/^data-(?:[a-z0-9]+-)*(?:path|href|to|route|url)$/i.test(attribute.name) && attribute.value) {
                            addLocator({ by: 'attr', name: attribute.name, value: attribute.value });
                        }
                    }
                    if (el.getAttribute('aria-label')) addLocator({ by: 'label', value: el.getAttribute('aria-label') });
                    addLocator({ by: 'role', role: el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag), value: label });
                    addLocator({ by: 'text', value: label });
                    addLocator({ by: 'css', value: selector });
                    interactiveElements.push({
                        label,
                        kind,
                        selector,
                        locators: locators.slice(0, 6),
                        identity: [
                            tag,
                            el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || '',
                            el.getAttribute('aria-label') || '',
                            el.getAttribute('name') || '',
                            el.getAttribute('href') || '',
                            label
                        ].join('|')
                    });
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

        components.interactiveElements = components.interactiveElements.map(({ identity: _identity, ...element }) => element);
        return ensureUniqueElementKeys(pageUrl, components);
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
                const largest = (groups) => {
                    let best = [];
                    for (const labels of groups.values()) {
                        if (labels.length > best.length) best = labels;
                    }
                    return best;
                };

                // Real tabs first: elements that declare themselves tabs. The
                // sibling-button heuristic below would otherwise let any larger
                // group of buttons (a section outline, a toolbar) outvote them.
                const tabGroups = new Map();
                for (const el of document.querySelectorAll('[role="tab"]')) {
                    if (el.closest('nav, header')) continue;
                    const text = (el.textContent || '').trim();
                    const group = el.closest('[role="tablist"]') || el.parentElement;
                    if (!text || text.length > maxTextChars || !group) continue;
                    if (!tabGroups.has(group)) tabGroups.set(group, []);
                    tabGroups.get(group).push(text);
                }
                const realTabs = largest(tabGroups);
                if (realTabs.length >= 2) return realTabs;

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
                return largest(groups);
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

    // What the page shows as loaded. A "tab" whose panel reads the same as this
    // (or as an earlier tab) is not a tab at all — a section link that only
    // scrolls, say — so it is dropped instead of being stored as a duplicate.
    const sameText = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    const seenText = new Set([sameText((await extractTabPanelSnapshot(page)).rawText)]);

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
            if (seenText.has(sameText(rawText))) continue;
            seenText.add(sameText(rawText));
            variants.push({ label, headings, rawText });
        } catch {
            // candidate not clickable, or page didn't settle — skip it, harmless
        }
    }
    return variants;
}

/**
 * Downloads and parses a PDF discovered while crawling a site, in place of a
 * Playwright page load (a PDF has no DOM to scrape). The `.pdf`-looking URL
 * is only ever a hint to get here — `extractDocumentText`'s magic-byte check
 * is what actually decides whether the response is a real PDF, so a link
 * that merely looks like a PDF but serves something else throws and is
 * skipped by the caller, same as any other broken page.
 *
 * The response body is read in a streamed loop with a running byte count
 * (never `res.arrayBuffer()` directly) so a missing or lying Content-Length
 * header can't be used to smuggle an oversized download into memory.
 */
async function extractPdfPage(urlStr) {
    await checkSSRFUrl(urlStr);
    const res = await safeFetch(urlStr);
    if (!res.ok) {
        return { ok: false, status: res.status };
    }

    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
        throw new Error(`PDF exceeds ${MAX_PDF_BYTES} byte cap (declared Content-Length: ${declaredLength})`);
    }

    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PDF_BYTES) {
            await reader.cancel();
            throw new Error(`PDF exceeds ${MAX_PDF_BYTES} byte cap while streaming`);
        }
        chunks.push(value);
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const text = await extractDocumentText(buffer, { mime: res.headers.get('content-type') || '', ext: 'pdf' });
    return { ok: true, text, links: [] };
}

/**
 * Navigates to one page, returns its visible text plus every same-origin
 * link found on it — both real `<a href>` tags and, for sites with none
 * (see discoverClientRoutedLinks), client-side-routed nav buttons — after
 * expanding any collapsed nav sections. Returns `{ ok: false }` for 4xx/5xx
 * responses — a 404'd link shouldn't get its error-page boilerplate indexed
 * as product knowledge.
 */
async function extractPage(page, urlStr, rootOrigin, { peekStates = false } = {}) {
    // 'networkidle' hangs/crashes on SPAs that keep a live connection open
    // (polling, websockets, dashboards) — they never go idle. Wait for the
    // DOM instead, then let client-side rendering settle adaptively.
    const response = await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Checked before waiting: an error page is not worth any render patience.
    if (response && response.status() >= 400) {
        return { ok: false, status: response.status() };
    }
    await waitForInitialRender(page);

    // Capture ordinary page accordions while they are still in their natural
    // initial state. The discovery pass restores every toggle it opens, so
    // hidden answers become separately indexable without contaminating the
    // base page text with a synthetic "everything expanded" state.
    const toggles = await discoverToggleVariants(page, urlStr);
    await expandCollapsedNav(page);
    const clientRoutedLinks = await discoverClientRoutedLinks(page, rootOrigin, { settle: waitForStableContent });
    // discoverClientRoutedLinks() navigates away and back per candidate —
    // restore any nav expansion state lost in that round-trip before the
    // final scrape below.
    await expandCollapsedNav(page);
    const components = await extractPageComponents(page, urlStr);
    if (toggles.length) components.toggles = toggles;

    // Logged-in panels only: press the page's own buttons and record what each
    // opens. Runs BEFORE the scrape below, which strips <style> and <script> and
    // so would leave nothing visible to press. The page is restored after each press.
    let stateLinks = [];
    if (peekStates) {
        // Restoring after a press can reload the page; a heavy app then shows a
        // skeleton first, which the quick wait would accept as "settled" and leave
        // the scrape below reading a half-drawn page. Wait like a first load does.
        const peeked = await peekAtButtons(page, urlStr, {
            settle: waitForInitialRender,
            allowCreate: process.env.URL_CRAWL_PEEK_CREATE === '1'
        });
        if (peeked.states.length) {
            components.states = peeked.states;
            // Say on each button what pressing it does.
            annotateElements(components);
        }
        stateLinks = peeked.links;
    }

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
    links.push(...clientRoutedLinks, ...stateLinks);

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
 * @param {{loginUrl?:string, username?:string, email?:string, password:string, selectors?:{username?:string,email?:string,password?:string,next?:string,submit?:string}}|null} [auth] -
 *   Same shape as the guided tour's demo-session auth (see `@repo/screen`'s
 *   `loginWithCredentials`) — logs in via the product's own login form before
 *   crawling. Without it, auth-gated pages are scraped anonymously and only
 *   the public/login view gets indexed.
 * @param {(current:number, max:number, pagesIndexSoFar:object, stats:object) => void|Promise<void>} [onProgress]
 *   `pagesIndexSoFar` is the SAME in-progress index object being built by
 *   this call, passed so the caller can checkpoint it (e.g. to Mongo) after
 *   every page — otherwise a long crawl interrupted partway through (a
 *   caller-side timeout, a crashed worker) has nothing durable to resume
 *   from and a retry re-crawls every page from scratch, including the
 *   expensive tab-discovery reload cycles. Awaited before continuing to the
 *   next page specifically so a slow/fire-and-forget checkpoint write can
 *   never land out of order and overwrite a later page's entry with an
 *   earlier, smaller snapshot.
 * @param {Map<string, {rawText:string, links:(string|{targetUrl:string,label?:string,kind?:string})[], parentUrl?:string|null, components?:object}>} [previousPages] -
 *   URLs already crawled/chunked in a prior ingestion of this same source.
 *   A URL with the current `indexVersion` is NOT re-navigated — its cached text/links are reused
 *   as-is and it doesn't count against `MAX_CRAWL_PAGES`, so the budget of
 *   real page loads goes entirely to URLs not yet indexed (e.g. pages only
 *   reachable after a login that wasn't configured on the first crawl).
 *   `links` entries may be plain URL strings (a source crawled before the
 *   `{label,targetUrl,kind}` shape existed) — `enqueueLinks` accepts both.
 *   Entries from an older index shape are fetched once to backfill newly
 *   introduced crawl semantics (such as element-aware toggles).
 *   Known trade-off: a current-version reused page's content is never refreshed by this
 *   mechanism even if the live site changed — only a `websiteUrl` change
 *   (a different root/crawl) or a manually forced full re-crawl would pick
 *   that up. Defaults to an empty Map (first-ever crawl of a source).
 * @returns {Promise<{ text: string, pages: { url: string, text: string }[], pagesIndex: Record<string, {rawText:string, links:{label:string,targetUrl:string,kind:string}[], parentUrl:string|null, components:{headings:object[], interactiveElements:object[], sections:object[]}, isPdf?:boolean}> }>}
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
        // A retry extends the durable checkpoint; it never replaces it with
        // only the subset reached so far in this attempt.
        const pagesIndex = Object.fromEntries(previousPages);
        let fetchedCount = 0;
        let succeededCount = 0;
        let failedCount = 0;
        let cachedCount = 0;

        const progressStats = () => ({
            attempted: fetchedCount,
            succeeded: succeededCount,
            failed: failedCount,
            cached: cachedCount,
            saved: Object.keys(pagesIndex).length,
            successRate: fetchedCount > 0 ? Math.round((succeededCount / fetchedCount) * 100) : 100
        });

        while (queue.length && fetchedCount < MAX_CRAWL_PAGES && visited.size < MAX_TOTAL_VISITED) {
            const { url: next, parentUrl, isPdfCandidate } = queue.shift();
            if (!next || visited.has(next)) continue;
            visited.add(next);

            const cached = previousPages.get(next);
            if (cached?.indexVersion === CRAWL_PAGE_INDEX_VERSION) {
                // Already crawled/chunked in a prior run of this source —
                // reuse its text/links (and parentUrl, if the cache predates
                // that field, it's simply absent — degrades to an unparented
                // structure-tree node, not an error) without a real page
                // load, and don't spend this run's MAX_CRAWL_PAGES budget on it.
                const normalizedCached = {
                    ...cached,
                    components: ensureUniqueElementKeys(next, cached.components)
                };
                pages.push({ url: next, text: normalizedCached.rawText });
                pagesIndex[next] = normalizedCached;
                cachedCount++;
                enqueueLinks(normalizedCached.links, queue, visited, rootOrigin, next);
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
                result = isPdfCandidate ? await extractPdfPage(next) : await extractPage(page, next, rootOrigin, { peekStates: Boolean(auth) });
            } catch {
                fetchedCount++;
                failedCount++;
                await onProgress?.(fetchedCount, MAX_CRAWL_PAGES, pagesIndex, progressStats());
                continue; // one broken page (or unparseable/oversized PDF) shouldn't kill the whole crawl
            }
            fetchedCount++;

            // 404/5xx — don't index the error page, and it has no real links
            // to follow (its "not found" boilerplate isn't a route map).
            if (!result.ok) {
                failedCount++;
                await onProgress?.(fetchedCount, MAX_CRAWL_PAGES, pagesIndex, progressStats());
                continue;
            }

            succeededCount++;

            pages.push({ url: next, text: result.text });
            pagesIndex[next] = {
                indexVersion: CRAWL_PAGE_INDEX_VERSION,
                rawText: result.text,
                links: result.links,
                parentUrl,
                components: result.components || { headings: [], interactiveElements: [], sections: [] },
                ...(result.tabVariants ? { tabVariants: result.tabVariants } : {}),
                ...(isPdfCandidate ? { isPdf: true } : {})
            };
            if (result.links.length) enqueueLinks(result.links, queue, visited, rootOrigin, next);
            await onProgress?.(fetchedCount, MAX_CRAWL_PAGES, pagesIndex, progressStats());
        }

        const cleanedPages = stripRepeatedBoilerplate(pages);
        return {
            text: cleanedPages.map((p) => `[Page: ${p.url}]\n${p.text}`).join('\n\n'),
            pages: cleanedPages,
            pagesIndex,
            stats: progressStats()
        };
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}
