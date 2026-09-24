function boundedPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function stableBucket(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 100;
}

/** Session-stable rollout. Shadow runs analysts but never mutates accepted state. */
export function createMultiAgentRolloutPolicy({ mode = 'off', canaryPercent = 0 } = {}) {
    const normalizedMode = ['off', 'shadow', 'canary'].includes(mode) ? mode : 'off';
    const percent = boundedPercent(canaryPercent);

    return Object.freeze({
        decide({ sessionId, capabilityEnabled }) {
            const bucket = stableBucket(sessionId);
            const selected = capabilityEnabled === true
                && normalizedMode !== 'off'
                && (normalizedMode === 'shadow' || bucket < percent);
            return Object.freeze({
                mode: normalizedMode,
                bucket,
                canaryPercent: percent,
                enabled: selected,
                applyAcceptedState: selected && normalizedMode === 'canary',
                cohort: !selected ? 'control' : normalizedMode
            });
        }
    });
}
