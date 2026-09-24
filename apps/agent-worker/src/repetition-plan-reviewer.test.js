import { describe, expect, it } from 'vitest';
import { createRepetitionPlanReviewer } from './repetition-plan-reviewer.js';

const identity = {
    topicId: 'topic:reporting',
    claimIds: ['claim:reporting:auto'],
    source: 'semantic_resolver'
};

function context() {
    return {
        obligations: { close: { requirement: 'required_before_close', status: 'pending' } },
        memory: {
            turnIndex: 10,
            coveredClaims: [{
                topicId: identity.topicId,
                claimId: identity.claimIds[0],
                highestStatus: 'demonstrated',
                lastDeliveryIntent: 'proactive_promotion',
                proactiveMentionCount: 1,
                proactiveDemoCount: 1,
                lastTurnIndex: 1
            }],
            knownFacts: [], unresolvedConcerns: [], declinedTopics: []
        }
    };
}

function node(id, deliveryIntent, requirement = 'preferred') {
    return {
        id,
        type: id === 'demo' ? 'demo' : 'answer',
        objective: id,
        deliveryIntent,
        requirement,
        semanticIdentity: identity
    };
}

describe('repetition plan reviewer', () => {
    it('removes exhausted proactive work while preserving answers and obligations', () => {
        const proposal = {
            proposedNodes: [
                node('promo', 'proactive_promotion'),
                node('answer', 'direct_answer'),
                node('close', 'proactive_promotion', 'required_before_close')
            ]
        };
        const revised = createRepetitionPlanReviewer({ enforce: true }).review(proposal, context());
        expect(revised.proposedNodes.map((item) => item.id)).toEqual(['answer', 'close']);
    });

    it('does not create an invalid empty route', () => {
        const proposal = { proposedNodes: [node('promo', 'proactive_promotion')] };
        expect(createRepetitionPlanReviewer({ enforce: true }).review(proposal, context())).toBe(proposal);
    });

    it('reports shadow decisions without changing the proposal', () => {
        const decisions = [];
        const proposal = { proposedNodes: [node('promo', 'proactive_promotion')] };
        const result = createRepetitionPlanReviewer({
            onDecision: (decision) => decisions.push(decision)
        }).review(proposal, context());

        expect(result).toBe(proposal);
        expect(decisions).toEqual([expect.objectContaining({
            nodeId: 'promo', allowed: false, reason: 'mention_budget_exhausted', enforced: false
        })]);
    });
});
