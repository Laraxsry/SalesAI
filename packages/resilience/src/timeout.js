/**
 * Races `fn()` against a timeout, rejecting if it doesn't settle in time.
 * A hung provider call (no error, just never returning) is just as much a
 * failure as a thrown one — without this, a single stuck request could
 * block a caller indefinitely instead of triggering the fallback chain.
 *
 * @param {() => Promise<any>} fn
 * @param {number} ms
 */
export function withTimeout(fn, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
        fn().then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}
