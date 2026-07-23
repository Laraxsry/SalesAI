import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * Backpressure (Phase 7): sheds new requests with 503 when the event loop is
 * clearly struggling, instead of accepting unlimited work and letting every
 * in-flight request (including ones that would've been fine) slow down and
 * eventually time out anyway. Event loop lag is used as the signal — for a
 * single-threaded Node process, it's the truest measure of "is this process
 * actually falling behind," unlike an arbitrary in-flight-request count
 * (which can't tell a cheap request from an expensive one).
 */

/** True if `lagMs` exceeds `thresholdMs` — the whole shedding decision, kept pure and testable on its own. */
export function isOverloaded(lagMs, thresholdMs) {
    return lagMs > thresholdMs;
}

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

// `histogram.mean` is cumulative since `.enable()` — over a long-running
// process, a brief real spike gets diluted into insignificance by hours of
// normal operation and the shedding decision would never trigger. Sampling
// `.max` and resetting once a second instead keeps this reflecting "the
// worst the event loop looked recently," not "on average, ever."
let recentMaxLagMs = 0;
const sampleInterval = setInterval(() => {
    recentMaxLagMs = histogram.max / 1e6;
    histogram.reset();
}, 1000);
sampleInterval.unref(); // purely instrumentation — must never keep the process alive on its own

/** Reads the most recently sampled event loop lag, in milliseconds. */
export function currentLagMs() {
    return recentMaxLagMs;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.thresholdMs] - lag above this sheds new requests
 * @param {string[]} [opts.exemptPaths] - never shed (orchestrator/monitoring
 *   probes: shedding these could make an already-busy-but-alive process get
 *   killed as if it were dead, and blinds operators to the overload itself)
 * @param {() => number} [opts.getLagMs] - injected for testing; defaults to `currentLagMs`
 */
export function backpressureMiddleware({
    thresholdMs = 200,
    exemptPaths = ['/health', '/ready', '/metrics'],
    getLagMs = currentLagMs
} = {}) {
    return (req, res, next) => {
        if (exemptPaths.includes(req.path)) return next();
        if (!isOverloaded(getLagMs(), thresholdMs)) return next();

        res.set('Retry-After', '1');
        res.status(503).json({
            error: 'ServerOverloaded',
            message: 'Server is under heavy load, please retry shortly'
        });
    };
}
