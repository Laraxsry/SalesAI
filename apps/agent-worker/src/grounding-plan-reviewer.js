const CLAIM_NODE_TYPES = new Set(['answer', 'demo']);

function isGrounded(node, context) {
    const allowedEvidence = new Set(context.evidenceIds);
    if (node.evidenceRefs.length === 0
        || node.evidenceRefs.some((evidenceId) => !allowedEvidence.has(evidenceId))) return false;
    if (node.type !== 'demo') return true;
    return context.allowedDemoTargets.some((target) =>
        target.pageUrl === node.pageIntent?.preferredUrl);
}

/**
 * Removes only unsupported, optional side claims. It deliberately retains an
 * unsupported node that claims to answer the active question, so the mandatory
 * validator rejects the whole route instead of silently hiding planner failure.
 */
export function createGroundingPlanReviewer({ enabled } = {}) {
    return {
        id: 'grounding',
        enabled,
        review(proposal, context) {
            const obligationIds = new Set(Object.keys(context.obligations));
            const activeQuestionId = context.activeQuestion?.id ?? null;
            const proposedNodes = proposal.proposedNodes.filter((node) => {
                const removable = CLAIM_NODE_TYPES.has(node.type)
                    && (node.createdBy === 'planner' || node.createdBy === 'fallback')
                    && !obligationIds.has(node.id)
                    && node.requirement !== 'required_before_close'
                    && node.sourceQuestionId !== activeQuestionId
                    && !isGrounded(node, context);
                return !removable;
            });

            if (proposedNodes.length === proposal.proposedNodes.length) return proposal;
            return {
                ...proposal,
                proposedNodes
            };
        }
    };
}
