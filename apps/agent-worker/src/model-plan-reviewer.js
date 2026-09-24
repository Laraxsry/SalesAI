/**
 * Vendor-neutral adapter for a future LLM critic. Provider SDKs remain in the
 * composition root; the planning application layer only sees PlanMiddleware.
 */
export function createModelPlanReviewer({
    id = 'model_critic',
    model,
    invoke,
    enabled,
    timeoutMs = 800
}) {
    if (typeof model !== 'string' || !model.trim()) {
        throw new TypeError('model is required');
    }
    if (typeof invoke !== 'function') {
        throw new TypeError('invoke must be a function');
    }

    return {
        id,
        model,
        enabled,
        timeoutMs,
        review(proposal, context) {
            return invoke({
                model,
                proposal,
                context
            });
        }
    };
}
