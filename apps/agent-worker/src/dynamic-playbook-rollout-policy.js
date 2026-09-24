const MODES = new Set(['off', 'shadow', 'canary']);

function clampPercent(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(100, Math.max(0, parsed));
}

/** FNV-1a: stable across processes and releases, unlike runtime hash helpers. */
export function stableRolloutBucket(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value)) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) % 10000;
}

/**
 * Selects an observation cohort only. It deliberately cannot grant dynamic
 * runtime authority; removing the legacy path requires the separate replay
 * readiness gate and an explicit future migration.
 */
export function createDynamicPlaybookRolloutPolicy({
    mode = 'off',
    canaryPercent = 0
} = {}) {
    const normalizedMode = MODES.has(mode) ? mode : 'off';
    const percentage = clampPercent(canaryPercent);

    return {
        decide({ sessionId }) {
            const base = {
                configuredMode: normalizedMode,
                dynamicStateEnabled: false,
                demoExecutionEligible: false,
                runtimeAuthority: 'legacy',
                legacyRetirementAllowed: false
            };
            if (normalizedMode === 'off') {
                return { ...base, cohort: 'control', reason: 'rollout_off', bucket: null };
            }
            if (normalizedMode === 'shadow') {
                return {
                    ...base,
                    cohort: 'shadow',
                    reason: 'shadow_enabled',
                    dynamicStateEnabled: true,
                    bucket: null
                };
            }

            const bucket = stableRolloutBucket(sessionId);
            const selected = bucket < percentage * 100;
            return selected
                ? {
                    ...base,
                    cohort: 'canary',
                    reason: 'stable_bucket_selected',
                    dynamicStateEnabled: true,
                    demoExecutionEligible: true,
                    bucket
                }
                : { ...base, cohort: 'control', reason: 'stable_bucket_not_selected', bucket };
        }
    };
}
