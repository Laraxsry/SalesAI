import { describe, expect, it } from 'vitest';
import { createGroundingPlanReviewer } from './grounding-plan-reviewer.js';
import { createSalesBalancePlanReviewer } from './sales-balance-plan-reviewer.js';

function node(id, fields = {}) {
    return {
        id, type: 'check', objective: id, requirement: 'preferred',
        sourceQuestionId: null, evidenceRefs: [], createdBy: 'planner',
        ...fields
    };
}

const context = {
    activeQuestion: { id: 'q1', text: 'Soru' },
    evidenceIds: ['e1'],
    allowedDemoTargets: [{ pageUrl: 'https://example.test/demo' }],
    obligations: { close: { requirement: 'required_before_close', status: 'pending' } }
};

describe('built-in plan reviewers', () => {
    it('grounding reviewer removes unsupported side claims but retains the active answer for fail-closed validation', () => {
        const proposal = {
            proposedNodes: [
                node('side', { type: 'answer' }),
                node('active', { type: 'answer', sourceQuestionId: 'q1' }),
                node('grounded', { type: 'answer', evidenceRefs: ['e1'] }),
                node('close', { type: 'obligation', requirement: 'required_before_close' })
            ]
        };
        const reviewed = createGroundingPlanReviewer().review(proposal, context);
        expect(reviewed.proposedNodes.map((item) => item.id))
            .toEqual(['active', 'grounded', 'close']);
    });

    it('sales balance reviewer stably puts active-question nodes first and closing obligations last', () => {
        const proposal = {
            proposedNodes: [
                node('generic'),
                node('close', { type: 'obligation', requirement: 'required_before_close' }),
                node('answer', { type: 'answer', sourceQuestionId: 'q1' }),
                node('demo', { type: 'demo', sourceQuestionId: 'q1' })
            ]
        };
        const reviewed = createSalesBalancePlanReviewer().review(proposal, context);
        expect(reviewed.proposedNodes.map((item) => item.id))
            .toEqual(['answer', 'demo', 'generic', 'close']);
    });
});
