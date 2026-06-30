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
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null));
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
