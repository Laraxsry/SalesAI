import { isSafeToPeek, labelShape, MAX_LABEL_CHARS } from './click-safety.js';
import { extractOverlayForm, markExistingInputs, tagNewFormRoot } from './form-learning.js';

/**
 * "Peek": press the buttons on a page and record what each one opens.
 *
 * Page text says a "Create workflow" button exists; it cannot say that pressing
 * it opens a dialog, which fields it asks for, or that a menu drops down. This
 * presses each safe, in-page button once, compares the page before and after,
 * records what appeared (a dialog, a menu, new controls, a navigation), then
 * puts the page back the way it was.
 *
 * It only looks. A press that is itself a save would be a write on the demo
 * account; that is allowed (the account is a dedicated demo), but every write
 * request the press triggered is recorded (`writeRequests`) so a button that
 * commits on its own is visible instead of silent. Filling forms and saving on
 * purpose is a separate step.
 *
 * Which labels are safe to press comes from click-safety.js: no side-effect or panel-action words,
 * no buttons that create something (unless `allowCreate`), no suggested AI prompts. The "wait until
 * the page settled" step is injected (`settle`) so this module does not depend
 * on the crawler that uses it.
 */

export const PEEK_CONFIG = {
    // Navigation chrome is handled by nav-discovery.js; peeking is about the page's own content.
    skipRegions: ['nav', 'header', 'aside', '[role="navigation"]', '[role="menubar"]', '[role="complementary"]'],
    controls: ['button', '[role="button"]'],
    // Folding sections (own pass), tabs (own pass), submits and disabled buttons are not peeked.
    skipSelf: ['[aria-expanded]', '[role="tab"]', '[type="submit"]', '[disabled]', '[aria-disabled="true"]'],
    // Anything that floats above the page when something opens.
    overlays: ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', 'dialog[open]', '[role="menu"]', '[role="listbox"]', '[popover]'],
    // What counts as "a control" when listing what appeared.
    interactive: ['button', 'a[href]', 'input', 'select', 'textarea', '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]', '[role="option"]'],
    closeLabels: '^(?:close|kapat|cancel|iptal|dismiss|done|x|×|✕)$',
    tagAttribute: 'data-salesai-peek',
    // Form reading (see form-learning.js): what was already on screen, the panel that appeared, the fields and buttons read.
    formControls: 'input, select, textarea, [role="combobox"], [role="switch"]',
    seenAttribute: 'data-salesai-seen',
    formRootAttribute: 'data-salesai-form-root',
    fieldAttribute: 'data-salesai-field',
    actionAttribute: 'data-salesai-action',
    commitOrCancelLabels: '^(?:create|save|add|submit|confirm|apply|done|ok|update|cancel|close|discard|oluştur|olustur|kaydet|ekle|iptal|kapat|uygula|onayla|tamam)\\b',
    maxLabelChars: MAX_LABEL_CHARS,
    maxTextChars: 600,
    maxNewElements: 25
};

const DEFAULT_MAX_PEEKS = Number(process.env.URL_CRAWL_MAX_PEEKS || 12);

// A request to the site's own host that is not a plain read, minus telemetry.
const TELEMETRY = /analytics|telemetry|tracking|track\b|\/collect|beacon|metrics|\brum\b|sentry|segment|gtm|\/log/i;

const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

/**
 * Runs INSIDE the page (via `page.evaluate`): self-contained, no imports.
 * Tags each candidate with its index and returns the labels in that order.
 */
export function collectPeekCandidates(config) {
    const skipRegions = config.skipRegions.join(', ');
    const skipSelf = config.skipSelf.join(', ');
    const overlays = config.overlays.join(', ');
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

    for (const stale of document.querySelectorAll(`[${config.tagAttribute}]`)) {
        stale.removeAttribute(config.tagAttribute);
    }

    const found = [];
    for (const el of document.querySelectorAll(config.controls.join(', '))) {
        if (el.closest(skipRegions) || el.closest(overlays) || el.matches(skipSelf) || !visible(el)) continue;
        const label = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
        if (!label || label.length > config.maxLabelChars) continue;
        found.push({ el, label });
    }

    // Suggested prompts of an AI assistant come as a row of chips. When at least half the buttons of a row
    // read like a sentence or a question, the row is prompts, short ones ("Fix greeting + language") included.
    // One question among many ordinary buttons does not make them prompts.
    const promptLike = (label) => label.endsWith('?') || label.split(/\s+/).length >= 5;
    const rows = new Map();
    for (const item of found) {
        const key = item.el.parentElement;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(item);
    }
    const promptRows = new Set(
        [...rows]
            .filter(([, items]) => items.filter((item) => promptLike(item.label)).length * 2 >= items.length)
            .map(([key]) => key)
    );

    const labels = [];
    for (const { el, label } of found) {
        if (promptRows.has(el.parentElement)) continue;
        el.setAttribute(config.tagAttribute, String(labels.length));
        labels.push(label);
    }
    return labels;
}

/**
 * Runs INSIDE the page: what is on screen right now — the visible controls and
 * every floating surface (dialog, menu, popover) with its title, text and the
 * controls inside it.
 */
export function snapshotPage(config) {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const interactive = config.interactive.join(', ');
    const labelOf = (el) =>
        clean(
            el.getAttribute('aria-label') ||
                el.getAttribute('title') ||
                el.getAttribute('placeholder') ||
                el.getAttribute('name') ||
                el.textContent ||
                el.value
        );

    const controlsIn = (root) =>
        [...root.querySelectorAll(interactive)]
            .filter(visible)
            .map((el) => ({ label: labelOf(el).slice(0, 80), kind: el.getAttribute('role') || el.tagName.toLowerCase() }))
            .filter((item) => item.label);

    const overlayKind = (el) => {
        const role = el.getAttribute('role');
        if (role === 'menu' || role === 'listbox') return 'menu';
        if (role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true' || el.matches('dialog')) {
            return 'dialog';
        }
        return 'popover';
    };

    const overlays = [...document.querySelectorAll(config.overlays.join(', '))]
        .filter(visible)
        .map((el) => {
            const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
            return {
                kind: overlayKind(el),
                title: clean(heading?.textContent || el.getAttribute('aria-label')).slice(0, 120),
                text: clean(el.innerText).slice(0, config.maxTextChars),
                elements: controlsIn(el)
            };
        });

    return { url: location.href, controls: controlsIn(document.body), overlays };
}

/** Runs INSIDE the page: how many floating surfaces are open. */
export function countOverlays(config) {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return [...document.querySelectorAll(config.overlays.join(', '))].filter(visible).length;
}

/** Runs INSIDE the page: presses the close/cancel control of the topmost surface. */
export function pressCloseControl(config) {
    const visible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const closeLabel = new RegExp(config.closeLabels, 'i');
    const surfaces = [...document.querySelectorAll(config.overlays.join(', '))].filter(visible);
    const top = surfaces[surfaces.length - 1];
    if (!top) return false;
    for (const el of top.querySelectorAll('button, [role="button"]')) {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (closeLabel.test(label)) {
            el.click();
            return true;
        }
    }
    return false;
}

const keyOf = (item) => `${item.kind}|${item.label}`;
const overlayKey = (overlay) => `${overlay.kind}|${overlay.title}|${overlay.text}`;

const withoutHash = (url) => url.split('#')[0];

/** What `after` shows that `before` did not. A `#section` jump on the same page is not a navigation. */
export function diffSnapshots(before, after, { maxNewElements = PEEK_CONFIG.maxNewElements } = {}) {
    const seenControls = new Set(before.controls.map(keyOf));
    const seenOverlays = new Set(before.overlays.map(overlayKey));
    return {
        urlChanged: withoutHash(after.url) !== withoutHash(before.url),
        overlays: after.overlays.filter((overlay) => !seenOverlays.has(overlayKey(overlay))),
        newElements: after.controls.filter((item) => !seenControls.has(keyOf(item))).slice(0, maxNewElements)
    };
}

/** Writes the page made to its own site (telemetry and third parties left out). @param {{ method:string, url:string }[]} requests */
export function writesTo(requests, siteHost) {
    const baseDomain = (host) => host.split('.').slice(-2).join('.');
    return requests
        .filter((request) => {
            if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return false;
            try {
                const url = new URL(request.url);
                return baseDomain(url.hostname) === baseDomain(siteHost) && !TELEMETRY.test(`${url.hostname}${url.pathname}`);
            } catch {
                return false;
            }
        })
        .map((request) => {
            const url = new URL(request.url);
            return `${request.method} ${url.host}${url.pathname}`;
        })
        .slice(0, 3);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} pageUrl the page being inspected (used to resolve the origin); the page is
 *   restored to whatever URL it is on when this is called
 * @param {{ settle:(page:import('playwright').Page)=>Promise<void>, maxPeeks?:number, allowCreate?:boolean }} deps
 * @returns {Promise<{ states:object[], links:{label:string, targetUrl:string, kind:'button'}[] }>}
 */
export async function peekAtButtons(page, pageUrl, { settle, maxPeeks = DEFAULT_MAX_PEEKS, allowCreate = false }) {
    const states = [];
    const links = new Map();
    const startUrl = page.url();
    const collect = () => page.evaluate(collectPeekCandidates, PEEK_CONFIG);
    const snapshot = () => page.evaluate(snapshotPage, PEEK_CONFIG);

    let labels;
    try {
        labels = await collect();
    } catch {
        return { states, links: [] };
    }

    let siteHost = '';
    let siteOrigin = '';
    try {
        const parsed = new URL(pageUrl);
        siteHost = parsed.hostname;
        siteOrigin = parsed.origin;
    } catch { /* no host: no write detection, no link recording */ }

    const requests = [];
    const onRequest = (request) => requests.push({ method: request.method(), url: request.url() });
    page.on?.('request', onRequest);

    // A press can open a new tab; close it so peeking never leaves stray tabs.
    const context = page.context?.();
    const closeStray = (opened) => {
        if (opened !== page) opened.close().catch(() => {});
    };
    context?.on?.('page', closeStray);

    try {
        const tried = new Set();
        let attempted = 0;
        for (const rawLabel of labels) {
            if (attempted >= maxPeeks) break;
            const label = normalize(rawLabel);
            // One press per shape: "Sep 22" and "Sep 23" open the same kind of thing.
            const shape = labelShape(label);
            if (tried.has(shape) || !isSafeToPeek(label, { allowCreate })) continue;
            tried.add(shape);
            attempted++;

            let needsReload = false;
            let baselineSnapshot = null;
            try {
                // Re-collect: earlier presses may have re-rendered the page and dropped the markers.
                const current = (await collect()).map(normalize);
                const index = current.indexOf(label);
                if (index === -1) continue;
                const element = await page.$(`[${PEEK_CONFIG.tagAttribute}="${index}"]`);
                if (!element) continue;

                const before = await snapshot();
                baselineSnapshot = before;
                await page.evaluate(markExistingInputs, PEEK_CONFIG).catch(() => {});
                requests.length = 0;
                await element.click({ timeout: 2000 });
                await page.waitForTimeout(400);
                const after = await snapshot();
                const diff = diffSnapshots(before, after);
                const writeRequests = writesTo(requests, siteHost);

                if (diff.urlChanged) {
                    // A press that goes somewhere else is navigation, like a menu item.
                    if (siteOrigin && after.url.startsWith(siteOrigin) && !links.has(after.url)) {
                        links.set(after.url, { label, targetUrl: after.url, kind: 'button' });
                    }
                    states.push({ trigger: label, kind: 'navigation', targetUrl: after.url, ...(writeRequests.length && { writeRequests }) });
                } else if (diff.overlays.length || diff.newElements.length) {
                    const [overlay] = diff.overlays;
                    // Reading a dialog's form is harmless and the dialog is open right now.
                    // A side panel or drawer has no dialog role: find it by the controls that appeared.
                    const hasPanelForm = !overlay && (await page.evaluate(tagNewFormRoot, PEEK_CONFIG).catch(() => false));
                    const form = overlay?.kind === 'dialog' || hasPanelForm
                        ? await page.evaluate(extractOverlayForm, PEEK_CONFIG).catch(() => null)
                        : null;
                    states.push({
                        trigger: label,
                        kind: overlay ? overlay.kind : 'content',
                        ...(overlay?.title && { title: overlay.title }),
                        ...(overlay?.text && { text: overlay.text }),
                        newElements: overlay ? overlay.elements.slice(0, PEEK_CONFIG.maxNewElements) : diff.newElements,
                        ...(form?.fields.length && { form }),
                        ...(writeRequests.length && { writeRequests })
                    });
                    // New content that is not a floating surface has no generic "close":
                    // reload so the next press starts from a known page.
                    needsReload = !overlay;
                } else if (writeRequests.length) {
                    // Nothing visible changed, but the press wrote data on its own.
                    states.push({ trigger: label, kind: 'write', writeRequests });
                }
            } catch {
                // not clickable, or the page changed under us — harmless, skip
            }

            await restore(page, startUrl, settle, { forceReload: needsReload, baseline: baselineSnapshot });
        }
    } finally {
        page.off?.('request', onRequest);
        context?.off?.('page', closeStray);
    }

    return { states, links: [...links.values()] };
}

/** Puts the page back: leave whatever opened, and return to `startUrl`. */
async function restore(page, startUrl, settle, { forceReload = false, baseline = null } = {}) {
    if (forceReload && page.url() === startUrl) {
        // A reload is slow (the whole app boots again). Try the cheap ways out first, and reload
        // only if the page is not back to showing what it showed before the press.
        const backToBaseline = async () => {
            if (!baseline) return false;
            const now = await page.evaluate(snapshotPage, PEEK_CONFIG).catch(() => null);
            if (!now) return false;
            const was = new Set(baseline.controls.map(keyOf));
            return now.controls.length === baseline.controls.length && now.controls.every((item) => was.has(keyOf(item)));
        };
        await Promise.resolve(page.keyboard?.press?.('Escape')).catch(() => {});
        await page.waitForTimeout(200);
        if (await backToBaseline()) return;
        await page.evaluate(pressCloseControl, PEEK_CONFIG).catch(() => false);
        await page.waitForTimeout(200);
        if (await backToBaseline()) return;
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await settle(page);
        return;
    }
    if (page.url() !== startUrl) {
        try {
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 });
        } catch {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        }
        await settle(page);
        return;
    }

    const open = () => page.evaluate(countOverlays, PEEK_CONFIG).catch(() => 0);
    if ((await open()) === 0) return;

    await Promise.resolve(page.keyboard?.press?.('Escape')).catch(() => {});
    await page.waitForTimeout(200);
    if ((await open()) === 0) return;

    await page.evaluate(pressCloseControl, PEEK_CONFIG).catch(() => false);
    await page.waitForTimeout(200);
    if ((await open()) === 0) return;

    // Nothing closed it: reload is the one way back to a known state.
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await settle(page);
}
