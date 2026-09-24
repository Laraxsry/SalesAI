import { evaluatePromotion } from './promotion-policy.js';

/**
 * Removes only optional proactive repetition. Customer-requested nodes and
 * obligations are never suppressed, even when the topic was covered before.
 */
export function createRepetitionPlanReviewer({
    enabled,
    policy,
    enforce = false,
    onDecision = () => {}
} = {}) {
    return {
        id: 'repetition',
        enabled,
        review(proposal, context) {
            const obligationIds = new Set(Object.keys(context.obligations));
            const proposedNodes = proposal.proposedNodes.filter((node) => {
                if (obligationIds.has(node.id) || node.requirement === 'required_before_close') {
                    try {
                        onDecision({
                            nodeId: node.id,
                            topicId: node.semanticIdentity?.topicId ?? null,
                            deliveryIntent: node.deliveryIntent,
                            target: node.type === 'demo' ? 'demo' : 'mention',
                            allowed: true,
                            reason: 'obligation_preserved',
                            enforced: enforce
                        });
                    } catch { /* advisory telemetry cannot affect planning */ }
                    return true;
                }
                const decision = evaluatePromotion({
                    memory: context.memory,
                    semanticIdentity: node.semanticIdentity,
                    deliveryIntent: node.deliveryIntent,
                    target: node.type === 'demo' ? 'demo' : 'mention'
                }, policy);
                try {
                    onDecision({
                        nodeId: node.id,
                        topicId: node.semanticIdentity?.topicId ?? null,
                        deliveryIntent: node.deliveryIntent,
                        target: node.type === 'demo' ? 'demo' : 'mention',
                        ...decision,
                        enforced: enforce
                    });
                } catch { /* advisory telemetry cannot affect planning */ }
                return !enforce || decision.allowed;
            });

            // RouteProposal requires at least one node. An empty advisory
            // revision cannot replace the planner proposal; the deterministic
            // validator remains the final authority.
            if (proposedNodes.length === 0
                || proposedNodes.length === proposal.proposedNodes.length) return proposal;
            return { ...proposal, proposedNodes };
        }
    };
}
