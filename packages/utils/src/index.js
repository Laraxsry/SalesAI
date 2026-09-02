import { customAlphabet } from 'nanoid';

const slugAlphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const nano = customAlphabet(slugAlphabet, 12);

/** Generates a short, URL-safe id (e.g. for share links). */
export function shortId(size = 12) {
    return customAlphabet(slugAlphabet, size)();
}

/** Generates a public share token for an activated agent link. */
export function shareToken() {
    return `s_${nano()}`;
}

/** Sleeps for the given number of milliseconds. */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once.
 * Originally written for the URL crawl's per-page synthesis calls
 * (`apps/worker-ingestion/src/handlers/ingest-source.js`); promoted here
 * once `apps/worker-general`'s knowledge-gap-analysis map phase needed the
 * same bounded-concurrency batching for its per-batch LLM calls.
 */
export async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * Polls a Playwright `page`'s `document.body.innerText` length until it
 * stops growing (stable for `stableChecks` consecutive polls) or `maxWaitMs`
 * elapses, instead of a fixed grace period after navigation. Originally
 * written for the URL crawler (`apps/worker-ingestion/src/extractors/url.js`)
 * — a real customer site (`cyberverse.com.tr`) has a ~4-5s fake-terminal
 * boot-animation before the real content mounts, and a fixed 3s wait
 * captured the animation instead of the page; promoted here once the live
 * guided tour (`packages/screen/src/cobrowse.js`) needed the exact same
 * fix — `GuidedTour.goto()`'s fixed `waitForTimeout(3000)` had the same
 * failure mode, just live: the agent would start narrating a page's real
 * content while the customer was still watching the boot animation.
 * `'networkidle'` isn't used (hangs on pages with a live connection —
 * polling/websockets/dashboards, which never go idle); polling text length
 * with a hard ceiling gets the same practical benefit without that hang risk.
 *
 * @param {import('playwright').Page} page
 * @param {{pollMs?:number, stableChecks?:number, maxWaitMs?:number}} [options]
 */
export async function waitForStableContent(page, { pollMs = 500, stableChecks = 2, maxWaitMs = 8000 } = {}) {
    const start = Date.now();
    let lastLen = -1;
    let stableCount = 0;
    while (Date.now() - start < maxWaitMs) {
        const len = await page.evaluate(() => (document.body.innerText || '').length).catch(() => lastLen);
        if (len === lastLen) {
            stableCount++;
            if (stableCount >= stableChecks) break;
        } else {
            stableCount = 0;
        }
        lastLen = len;
        await page.waitForTimeout(pollMs);
    }
}

/** Splits an array into chunks of `size`. */
export function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/** Removes undefined/null values from an object (shallow). */
export function compact(obj) {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)
    );
}

/**
 * Builds the exact two-line snippet a seller pastes onto their site to embed
 * the widget (Phase 5). Kept as one pure, testable function since every
 * customer's integration depends on this template being right — a broken
 * tag here breaks every embed at once, not just the one seller who copies it
 * next.
 *
 * @param {{ apiBaseUrl: string, shareToken: string, sdkVersion: string }} params
 */
export function buildEmbedSnippet({ apiBaseUrl, shareToken, sdkVersion }) {
    return [
        `<script src="${apiBaseUrl}/sdk/salesai.js?v=${sdkVersion}"></script>`,
        `<script>SalesAI.init({ shareToken: '${shareToken}' }).mount();</script>`
    ].join('\n');
}

/** Simple retry with exponential backoff. */
export async function retry(fn, { attempts = 3, baseMs = 200 } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            await sleep(baseMs * 2 ** i);
        }
    }
    throw lastErr;
}

/**
 * Agent/product docs store an ISO language code; prompts (persona system
 * prompt, vision/caption prompts) read better — and steer the model more
 * reliably — with the language spelled out. Single shared map so
 * `packages/agent/src/persona.js` and vision-captioning prompts
 * (`apps/worker-ingestion`) can't drift out of sync with each other.
 */
export const LANGUAGE_NAMES = { en: 'English', tr: 'Turkish', de: 'German', fr: 'French', es: 'Spanish' };

/** Resolves an ISO language code to its spelled-out name; falls back to the code itself if unmapped. */
export function languageName(code) {
    return LANGUAGE_NAMES[code] || code;
}

// Phase 8: Security utilities
export { redactPII, redactFields } from './pii-redactor.js';
export { logAudit, extractRequestMeta, AUDIT_ACTIONS } from './audit.js';
export * from './safeFetch.js';
// Phase 8 Task 4.2: Field-level envelope encryption
export { encryptField, decryptField, validateEncryptionKey } from './crypto.js';
