function stableBucket(value) {
    let hash = 2166136261;
    for (const char of value) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 100;
}

/** Missing config preserves existing behavior; malformed opt-in fails closed. */
export function reviewerExperimentPercent(value) {
    if (value === undefined || value === null || value === '') return 100;
    const percent = Number(value);
    return Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : 0;
}

/**
 * Deterministic session assignment for reviewer A/B and gradual rollout.
 * The same session + experiment salt always receives the same decision.
 */
export function createPlanMiddlewareExperimentGate({
    rolloutPercent = 100,
    experimentId
}) {
    const boundedPercent = Math.max(0, Math.min(100, Number(rolloutPercent) || 0));
    if (typeof experimentId !== 'string' || !experimentId.trim()) {
        throw new TypeError('experimentId is required');
    }

    return (context) => {
        if (boundedPercent === 0) return false;
        if (boundedPercent === 100) return true;
        return stableBucket(`${experimentId}:${context.sessionId}`) < boundedPercent;
    };
}
