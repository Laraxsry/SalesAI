/** Sleeps for the given number of milliseconds. */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries `fn` with exponential backoff + full jitter.
 *
 * Jitter matters here specifically because a provider outage typically
 * fails many concurrent requests at once; without jitter they'd all retry
 * again at the exact same moment (a "thundering herd"), turning a brief
 * blip into a synchronized second wave of load on a dependency that's
 * already struggling. Picking a *random* delay up to the exponential
 * ceiling — rather than the ceiling itself — spreads retries out instead.
 *
 * @param {() => Promise<any>} fn
 * @param {{ attempts?: number, baseMs?: number, maxMs?: number }} [opts]
 */
export async function retryWithJitter(fn, { attempts = 2, baseMs = 200, maxMs = 5_000 } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i === attempts - 1) break; // last attempt — don't sleep, just fail
            const ceiling = Math.min(maxMs, baseMs * 2 ** i);
            await sleep(Math.random() * ceiling);
        }
    }
    throw lastErr;
}
