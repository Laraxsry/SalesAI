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
