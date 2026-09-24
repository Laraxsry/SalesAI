const REQUIRED_PROFILES = new Set(['short_pitch', 'browser_demo', 'objection_heavy']);

/** Mechanical gate for replay/dress-rehearsal evidence; live A/V review stays manual. */
export function evaluateMultiAgentPilotReadiness({ sessions = [], maxFirstResponseLatencyMs = 2500 } = {}) {
    const blockers = [];
    const profiles = new Set(sessions.map((session) => session.profile));
    for (const profile of REQUIRED_PROFILES) {
        if (!profiles.has(profile)) blockers.push(`missing_profile:${profile}`);
    }
    if (new Set(sessions.map((session) => session.productId)).size < 3) {
        blockers.push('fewer_than_three_products');
    }
    if (sessions.some((session) => session.memoryLeakageCount > 0)) {
        blockers.push('participant_memory_leakage');
    }
    if (sessions.some((session) => session.firstResponseLatencyMs > maxFirstResponseLatencyMs)) {
        blockers.push('first_response_latency_budget_exceeded');
    }
    if (sessions.some((session) => !['shadow', 'canary'].includes(session.cohort))) {
        blockers.push('invalid_rollout_cohort');
    }
    return Object.freeze({
        readyForLivePilot: blockers.length === 0,
        blockers,
        productCount: new Set(sessions.map((session) => session.productId)).size,
        profiles: [...profiles].sort()
    });
}
