import { describe, expect, it, vi } from 'vitest';
import { createModelRoutePlanner } from './model-route-planner.js';
import { createResilientRoutePlanner } from './resilient-route-planner.js';

const node = (id, type, sourceQuestionId = 'question-1') => ({
    id, type, objective: id, sourceQuestionId,
    evidenceRefs: type === 'answer' || type === 'demo' ? ['evidence-1'] : [],
    pageIntent: type === 'demo' ? { preferredUrl: 'https://example.com/demo' } : null,
    createdBy: 'fallback'
});
const baseline = {
    baseRevision: 0, planningGeneration: 1, reason: 'customer_question',
    proposedNodes: [node('answer', 'answer'), node('demo', 'demo'),
        node('check', 'check'), node('closing', 'obligation', null)],
    preserveObligationIds: ['closing'], obsoleteOptionalNodeIds: []
};
const context = {
    activeQuestion: { id: 'question-1', text: 'How does this work?' },
    knowledge: { status: 'grounded_with_demo' },
    memory: { coveredClaims: [], declinedTopics: [] }
};
const candidates = { propose: vi.fn(async () => baseline) };

describe('model route planner', () => {
    it('selects safe candidate steps while preserving the answer and closing', async () => {
        const complete = vi.fn(async () => ({ text: JSON.stringify({
            selectedNodeIds: ['answer', 'check']
        }) }));
        const planner = createModelRoutePlanner({ complete, candidates });
        const proposal = await planner.propose(context);
        expect(proposal.proposedNodes.map((step) => step.id))
            .toEqual(['answer', 'check', 'closing']);
        expect(proposal.proposedNodes[0].createdBy).toBe('planner');
        expect(proposal.proposedNodes[2].createdBy).toBe('fallback');
        expect(complete.mock.calls[0][0].messages[0].content)
            .not.toContain('https://example.com/demo');
        expect(complete.mock.calls[0][0].responseFormat)
            .toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    });

    it.each([
        '{"selectedNodeIds":["demo"]}',
        '{"selectedNodeIds":["answer","fabricated"]}',
        '{"selectedNodeIds":["answer","answer"]}',
        '{"selectedNodeIds":["check","answer"]}',
        'not-json'
    ])('rejects unsafe model selection %s', async (text) => {
        const planner = createModelRoutePlanner({
            complete: async () => ({ text }), candidates
        });
        await expect(planner.propose(context)).rejects.toThrow();
    });

    it('falls back to the deterministic route when the model fails', async () => {
        const planner = createResilientRoutePlanner({
            primary: createModelRoutePlanner({
                complete: async () => ({ text: 'invalid' }), candidates
            }),
            fallback: candidates
        });
        await expect(planner.propose(context)).resolves.toBe(baseline);
    });
});
