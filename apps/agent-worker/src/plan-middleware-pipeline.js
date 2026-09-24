import { RouteProposalInput } from '@repo/contracts';

export class PlanMiddlewareTimeoutError extends Error {
    constructor(middlewareId, timeoutMs) {
        super(`plan middleware ${middlewareId} timed out after ${timeoutMs}ms`);
        this.name = 'PlanMiddlewareTimeoutError';
        this.middlewareId = middlewareId;
    }
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function immutableCopy(value) {
    return deepFreeze(structuredClone(value));
}

async function reviewWithTimeout(middleware, proposal, context, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(() => middleware.review(
                immutableCopy(proposal),
                immutableCopy(context)
            )),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(
                    new PlanMiddlewareTimeoutError(middleware.id, timeoutMs)
                ), timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Runs advisory proposal reviewers in order. Every reviewer is fail-open, but
 * its output must still satisfy the shared proposal contract. The mandatory
 * deterministic route validator remains a separate, fail-closed boundary.
 */
export function createPlanMiddlewarePipeline({
    middlewares = [],
    defaultTimeoutMs = 400,
    onReview = () => {}
} = {}) {
    function report(result) {
        try {
            onReview(result);
        } catch {
            // Review telemetry cannot affect a live planning decision.
        }
    }

    return {
        async review({ proposal, context }) {
            if (middlewares.length === 0) return { proposal, reviews: [] };

            const initial = RouteProposalInput.safeParse(proposal);
            if (!initial.success) {
                const result = { middlewareId: null, status: 'skipped_invalid_input' };
                report(result);
                return { proposal, reviews: [result] };
            }

            let current = initial.data;
            const reviews = [];
            for (const middleware of middlewares) {
                const middlewareId = middleware.id;
                if (typeof middlewareId !== 'string' || typeof middleware.review !== 'function') {
                    const result = { middlewareId: middlewareId ?? null, status: 'skipped_invalid_middleware' };
                    reviews.push(result);
                    report(result);
                    continue;
                }

                let enabled = true;
                try {
                    enabled = middleware.enabled ? Boolean(middleware.enabled(context)) : true;
                } catch {
                    enabled = false;
                }
                if (!enabled) {
                    const result = { middlewareId, status: 'skipped_disabled' };
                    reviews.push(result);
                    report(result);
                    continue;
                }

                try {
                    const candidate = await reviewWithTimeout(
                        middleware,
                        current,
                        context,
                        middleware.timeoutMs ?? defaultTimeoutMs
                    );
                    const parsed = RouteProposalInput.safeParse(candidate);
                    if (!parsed.success) {
                        const result = { middlewareId, status: 'skipped_invalid_output' };
                        reviews.push(result);
                        report(result);
                        continue;
                    }

                    const changed = JSON.stringify(parsed.data) !== JSON.stringify(current);
                    current = parsed.data;
                    const result = { middlewareId, status: changed ? 'revised' : 'passed' };
                    reviews.push(result);
                    report(result);
                } catch (error) {
                    const result = {
                        middlewareId,
                        status: error instanceof PlanMiddlewareTimeoutError ? 'skipped_timeout' : 'skipped_error'
                    };
                    reviews.push(result);
                    report(result);
                }
            }

            return { proposal: current, reviews };
        }
    };
}
