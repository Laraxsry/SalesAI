export class RoutePlannerTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`route planner timed out after ${timeoutMs}ms`);
        this.name = 'RoutePlannerTimeoutError';
    }
}

export async function withPlannerTimeout(planner, context, { timeoutMs = 1200 } = {}) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(() => planner.propose(context)),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new RoutePlannerTimeoutError(timeoutMs)), timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** Decorator implementing primary -> deterministic fallback without state access. */
export function createResilientRoutePlanner({
    primary,
    fallback,
    timeoutMs = 1200,
    onFallback = () => {}
}) {
    return {
        async propose(context) {
            try {
                return await withPlannerTimeout(primary, context, { timeoutMs });
            } catch (error) {
                try {
                    onFallback({ error, context });
                } catch {
                    // Planner observability cannot break fallback planning.
                }
                return fallback.propose(context);
            }
        }
    };
}
