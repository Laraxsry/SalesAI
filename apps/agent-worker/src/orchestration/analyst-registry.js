const ALLOWED_CONTEXT_NEEDS = new Set([
    'participant_memory',
    'shared_memory',
    'route_proposal',
    'planning_context'
]);

function validateAnalyst(analyst) {
    if (!analyst || typeof analyst !== 'object') throw new TypeError('analyst must be an object');
    if (typeof analyst.id !== 'string' || !/^[a-z][a-z0-9._-]{0,95}$/.test(analyst.id)) {
        throw new TypeError('analyst id is invalid');
    }
    if (typeof analyst.version !== 'string' || !analyst.version.trim()) {
        throw new TypeError(`analyst ${analyst.id} requires version`);
    }
    if (typeof analyst.supports !== 'function' || typeof analyst.analyze !== 'function') {
        throw new TypeError(`analyst ${analyst.id} requires supports and analyze`);
    }
    const needs = analyst.contextNeeds ?? [];
    if (!Array.isArray(needs) || needs.some((need) => !ALLOWED_CONTEXT_NEEDS.has(need))) {
        throw new TypeError(`analyst ${analyst.id} declares unsupported context`);
    }
}

export function createAnalystRegistry(initialAnalysts = []) {
    const analysts = new Map();

    function register(analyst) {
        validateAnalyst(analyst);
        if (analysts.has(analyst.id)) throw new Error(`duplicate analyst id: ${analyst.id}`);
        analysts.set(analyst.id, analyst);
        return () => analysts.delete(analyst.id);
    }

    for (const analyst of initialAnalysts) register(analyst);

    return Object.freeze({
        register,
        get(id) {
            return analysts.get(id) ?? null;
        },
        matching(event) {
            return [...analysts.values()].filter((analyst) => {
                try {
                    return analyst.supports(event) === true;
                } catch {
                    return false;
                }
            });
        },
        list() {
            return [...analysts.values()];
        }
    });
}
