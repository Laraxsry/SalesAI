/**
 * Circuit breaker (Phase 7 — provider fallback).
 *
 * Tracks failures for one named dependency (e.g. "llm:openai") across many
 * calls over time — unlike a retry loop, which forgets everything once a
 * single call finishes. Three states:
 *
 *   CLOSED     — normal operation. Failures increment a counter.
 *   OPEN       — too many recent failures; calls are rejected immediately
 *                (without even attempting the dependency) until `resetTimeoutMs`
 *                has passed. This is the whole point: don't keep hammering a
 *                dependency that's already down, and don't make callers wait
 *                out a slow timeout on every single request while it's down.
 *   HALF_OPEN  — the cooldown elapsed; the next single call is allowed
 *                through as a probe. Success closes the circuit again;
 *                failure re-opens it for another full cooldown.
 */

const State = Object.freeze({ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half-open' });

export class CircuitBreaker {
    /**
     * @param {string} name - for logging/introspection only
     * @param {{ failureThreshold?: number, resetTimeoutMs?: number }} [opts]
     */
    constructor(name, { failureThreshold = 5, resetTimeoutMs = 30_000 } = {}) {
        this.name = name;
        this.failureThreshold = failureThreshold;
        this.resetTimeoutMs = resetTimeoutMs;
        this.state = State.CLOSED;
        this.failureCount = 0;
        this.openedAt = null;
    }

    /**
     * True if a call should be attempted right now. Also performs the
     * OPEN -> HALF_OPEN transition as a side effect once the cooldown has
     * elapsed, since that transition only ever needs to be checked here.
     */
    canAttempt() {
        if (this.state !== State.OPEN) return true;
        if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
            this.state = State.HALF_OPEN;
            return true;
        }
        return false;
    }

    /** Records a successful call. Fully resets the breaker to CLOSED. */
    onSuccess() {
        this.state = State.CLOSED;
        this.failureCount = 0;
        this.openedAt = null;
    }

    /**
     * Records a failed call. A single failure while HALF_OPEN (the probe)
     * re-opens the circuit immediately — the probe existing failing at all
     * means the dependency isn't back yet, no need to accumulate a fresh
     * threshold of failures again.
     */
    onFailure() {
        if (this.state === State.HALF_OPEN) {
            this._open();
            return;
        }
        this.failureCount += 1;
        if (this.failureCount >= this.failureThreshold) {
            this._open();
        }
    }

    getState() {
        return this.state;
    }

    _open() {
        this.state = State.OPEN;
        this.openedAt = Date.now();
    }
}

const registry = new Map();

/**
 * Returns the shared, persistent breaker for `key` (creating it on first
 * use). Callers that construct their fallback policy fresh on every
 * invocation (e.g. the avatar chain, which varies per agent) still get
 * continuous, correct breaker state per provider name, because the state
 * lives here — not on whatever object happened to call this.
 */
export function getBreaker(key, opts) {
    if (!registry.has(key)) registry.set(key, new CircuitBreaker(key, opts));
    return registry.get(key);
}

/** Test-only: clears all breaker state between test cases. */
export function _resetRegistry() {
    registry.clear();
}
