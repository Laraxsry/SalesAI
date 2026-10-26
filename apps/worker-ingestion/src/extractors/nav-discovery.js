import { isSafeNavClick, MAX_LABEL_CHARS } from './click-safety.js';

/**
 * Client-routed navigation discovery.
 *
 * Dashboards often render navigation as plain `div`s with a JS click handler
 * and no `href`, so scraping `a[href]` finds nothing and the crawl never
 * leaves the first page. This click-tests short-label controls inside
 * navigation regions and records every URL a click actually navigates to,
 * then returns to the original page before trying the next candidate.
 *
 * A candidate is anything inside a navigation region that is
 *   - a real control (`button`, `role=button|link|menuitem`, `a` without href), or
 *   - carries a route attribute (`data-copilot-nav-path`, `data-href`, …), or
 *   - shows a pointer cursor (outermost such element only).
 * Collapsible section headers (`aria-expanded`) are never candidates: clicking
 * them folds the menu away; `expandCollapsedNav` already opens them.
 *
 * What is safe to click is decided by click-safety.js; the "wait until the
 * page settled" step is injected (`settle`) so this module does not depend on
 * the crawler that uses it.
 */

export const NAV_DISCOVERY_CONFIG = {
    // Where primary navigation lives. `aside` covers app sidebars.
    regions: ['nav', 'header', 'aside', '[role="navigation"]', '[role="menubar"]', '[role="complementary"]'],
    // Real controls. `a[href]` is deliberately absent: the crawler reads real links without clicking.
    controls: ['button', '[role="button"]', '[role="link"]', '[role="menuitem"]', 'a:not([href])'],
    // Attribute names that declare where an element navigates (RegExp source, matched case-insensitively).
    routeAttribute: '^data-(?:[a-z0-9]+-)*(?:path|href|to|route|url)$',
    // Temporary marker the page-side collector writes so a candidate can be re-found for the click.
    tagAttribute: 'data-salesai-nav',
    maxLabelChars: MAX_LABEL_CHARS
};

// Bound on how many candidates get click-tested per page; a sidebar plus a
// header comfortably fit, a pathological page does not run away.
const DEFAULT_MAX_CLICKS = Number(process.env.URL_CRAWL_MAX_NAV_CLICKS || 30);

const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

/**
 * Runs INSIDE the page (via `page.evaluate`), so it must stay self-contained:
 * no imports, no outer variables. Tags each candidate with its index and
 * returns the candidates' labels in that order.
 */
export function collectNavCandidates(config) {
    const inRegion = config.regions.map((region) => `${region} *`).join(', ');
    const controlSelector = config.controls.join(', ');
    const routeAttribute = new RegExp(config.routeAttribute, 'i');
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const pointer = (el) => getComputedStyle(el).cursor === 'pointer';

    for (const stale of document.querySelectorAll(`[${config.tagAttribute}]`)) {
        stale.removeAttribute(config.tagAttribute);
    }

    const found = [];
    for (const el of document.querySelectorAll(inRegion)) {
        if (el.hasAttribute('aria-expanded') || el.matches('a[href]')) continue;
        const label = clean(el.textContent);
        if (!label || label.length > config.maxLabelChars) continue;

        const isControl = el.matches(controlSelector);
        const declaresRoute = [...el.attributes].some((attr) => routeAttribute.test(attr.name) && attr.value);
        // `cursor` is inherited, so every child of a pointer element is a
        // pointer too: only the outermost one is the clickable thing.
        const isPointerRoot = pointer(el) && !(el.parentElement && pointer(el.parentElement));
        if (isControl || declaresRoute || isPointerRoot) found.push({ el, label });
    }

    // A candidate inside another candidate is part of it, not a second item.
    const outermost = found.filter(({ el }) => !found.some((other) => other.el !== el && other.el.contains(el)));
    outermost.forEach(({ el }, index) => el.setAttribute(config.tagAttribute, String(index)));
    return outermost.map(({ label }) => label);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} rootOrigin - only URLs under this origin are recorded
 * @param {{settle:(page:import('playwright').Page)=>Promise<void>, maxClicks?:number}} deps
 * @returns {Promise<{label:string, targetUrl:string, kind:'button'}[]>}
 */
export async function discoverClientRoutedLinks(page, rootOrigin, { settle, maxClicks = DEFAULT_MAX_CLICKS }) {
    const originalUrl = page.url();
    // Keyed by targetUrl so two differently-labelled controls landing on the
    // same URL don't produce duplicate site-structure edges.
    const discovered = new Map();
    const collect = () => page.evaluate(collectNavCandidates, NAV_DISCOVERY_CONFIG);

    let labels;
    try {
        labels = await collect();
    } catch {
        return [];
    }

    // A click can open a new tab (target=_blank, window.open). Close any such
    // page so exploring never leaves stray tabs behind.
    const context = page.context?.();
    const closeStray = (opened) => {
        if (opened !== page) opened.close().catch(() => {});
    };
    context?.on?.('page', closeStray);

    try {
        const tried = new Set();
        let attempted = 0;
        for (const rawLabel of labels) {
            if (attempted >= maxClicks) break;
            const label = normalize(rawLabel);
            // The same label often appears twice (sidebar and header): one
            // click is enough to learn where it leads.
            if (tried.has(label) || !isSafeNavClick(label)) continue;
            tried.add(label);
            attempted++;

            try {
                // Re-collect each time: after going back, the page may have
                // re-rendered and dropped the markers from the previous pass.
                const current = (await collect()).map(normalize);
                const index = current.indexOf(label);
                if (index === -1) continue;
                const element = await page.$(`[${NAV_DISCOVERY_CONFIG.tagAttribute}="${index}"]`);
                if (!element) continue;
                await element.click({ timeout: 2000 });
                await page.waitForTimeout(300);
                const newUrl = page.url();
                if (newUrl !== originalUrl && newUrl.startsWith(rootOrigin) && !discovered.has(newUrl)) {
                    discovered.set(newUrl, { label, targetUrl: newUrl, kind: 'button' });
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
                await settle(page);
            } else {
                // A click that opened a menu or dialog instead of navigating
                // would otherwise cover the next candidate.
                await Promise.resolve(page.keyboard?.press?.('Escape')).catch(() => {});
            }
        }
    } finally {
        context?.off?.('page', closeStray);
    }

    return [...discovered.values()];
}
