import { DiscoveredFactInput, KnownFactResolutionInput } from '@repo/contracts';

const SOURCE_PRIORITY = {
    crm: 500,
    survey: 400,
    conversation: 300,
    operator: 200
};

function comparableValue(value) {
    if (value === undefined) return 'undefined';
    try {
        return JSON.stringify(value, Object.keys(value ?? {}).sort());
    } catch {
        return String(value);
    }
}

/**
 * Resolves facts from memory plus optional external provider ports. Provider
 * failures are explicit and fail-safe; they never silently become "unknown".
 */
export function createKnownFactResolver({
    providers = [],
    highConfidence = 0.85,
    verificationConfidence = 0.5
} = {}) {
    return {
        async resolve({ key, memory, context = {} }) {
            const asked = memory.askedQuestions?.[key];
            if (asked && ['declined', 'dismissed', 'expired'].includes(asked.status)) {
                return KnownFactResolutionInput.parse({
                    key, status: 'declined', fact: null, candidates: [],
                    reason: 'customer_previously_declined'
                });
            }

            const ranked = [];
            const memoryFact = memory.discoveredFacts?.[key];
            if (memoryFact) {
                const parsed = DiscoveredFactInput.safeParse(memoryFact);
                if (parsed.success) ranked.push({
                    fact: parsed.data,
                    priority: SOURCE_PRIORITY[parsed.data.source] ?? 0
                });
            }

            const failures = [];
            for (const provider of [...providers].sort((a, b) =>
                (b.priority ?? 0) - (a.priority ?? 0))) {
                if (typeof provider?.lookup !== 'function') continue;
                try {
                    const result = await provider.lookup(key, context);
                    const values = Array.isArray(result) ? result : result ? [result] : [];
                    for (const candidate of values) {
                        const parsed = DiscoveredFactInput.safeParse(candidate);
                        if (parsed.success && parsed.data.key === key) {
                            ranked.push({
                                fact: parsed.data,
                                priority: provider.priority
                                    ?? SOURCE_PRIORITY[parsed.data.source]
                                    ?? 0
                            });
                        }
                    }
                } catch {
                    failures.push({ id: provider.id ?? 'anonymous', priority: provider.priority ?? 0 });
                }
            }

            ranked.sort((a, b) => b.priority - a.priority
                || b.fact.confidence - a.fact.confidence
                || b.fact.capturedTurnIndex - a.fact.capturedTurnIndex);
            const candidates = ranked.map((item) => item.fact).slice(0, 20);
            if (ranked.length === 0) {
                return KnownFactResolutionInput.parse({
                    key,
                    status: failures.length ? 'unavailable' : 'unknown',
                    fact: null,
                    candidates: [],
                    reason: failures.length ? 'fact_source_unavailable' : 'no_known_fact'
                });
            }

            const credibleValues = new Set(ranked
                .filter((item) => item.fact.confidence >= verificationConfidence)
                .map((item) => comparableValue(item.fact.value)));
            if (credibleValues.size > 1) {
                return KnownFactResolutionInput.parse({
                    key, status: 'conflict', fact: ranked[0].fact, candidates,
                    reason: 'conflicting_fact_sources'
                });
            }

            const selected = ranked[0];
            const higherPriorityUnavailable = failures.some((failure) =>
                failure.priority > selected.priority);
            if (selected.fact.confidence >= highConfidence && !higherPriorityUnavailable) {
                return KnownFactResolutionInput.parse({
                    key, status: 'known', fact: selected.fact, candidates,
                    reason: 'high_confidence_fact'
                });
            }
            return KnownFactResolutionInput.parse({
                key,
                status: selected.fact.confidence >= verificationConfidence
                    ? 'verify'
                    : higherPriorityUnavailable ? 'unavailable' : 'unknown',
                fact: selected.fact,
                candidates,
                reason: higherPriorityUnavailable
                    ? 'higher_priority_source_unavailable'
                    : selected.fact.confidence >= verificationConfidence
                        ? 'medium_confidence_fact'
                        : 'low_confidence_fact'
            });
        }
    };
}
