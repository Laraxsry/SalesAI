/**
 * Stable route ordering policy: answer the visitor's active question first,
 * keep supporting optional work next, and return pending closing obligations
 * only after the question-specific branch. It changes no node content.
 */
export function createSalesBalancePlanReviewer({ enabled } = {}) {
    return {
        id: 'sales_balance',
        enabled,
        review(proposal, context) {
            if (!context.activeQuestion) return proposal;
            const obligationIds = new Set(Object.keys(context.obligations));
            const questionNodes = [];
            const supportingNodes = [];
            const obligationNodes = [];

            for (const node of proposal.proposedNodes) {
                if (obligationIds.has(node.id) || node.requirement === 'required_before_close') {
                    obligationNodes.push(node);
                } else if (node.sourceQuestionId === context.activeQuestion.id) {
                    questionNodes.push(node);
                } else {
                    supportingNodes.push(node);
                }
            }

            return {
                ...proposal,
                proposedNodes: [...questionNodes, ...supportingNodes, ...obligationNodes]
            };
        }
    };
}
