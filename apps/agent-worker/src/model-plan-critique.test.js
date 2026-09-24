import { describe, expect, it, vi } from 'vitest';
import { createModelPlanCritiqueInvocation } from './model-plan-critique.js';
import { createModelPlanReviewer } from './model-plan-reviewer.js';
import { createPlanMiddlewarePipeline } from './plan-middleware-pipeline.js';

const node = (id, type, requirement = 'preferred') => ({
    id, type, requirement, objective: id,
    sourceQuestionId: type === 'obligation' ? null : 'q1',
    evidenceRefs: ['e1'], semanticIdentity: null
});
const proposal = {
    baseRevision: 0, planningGeneration: 1, reason: 'customer_question',
    proposedNodes: [node('answer', 'answer'), node('demo', 'demo'),
        node('check', 'check'), node('closing', 'obligation', 'required_before_close')],
    preserveObligationIds: ['closing'], obsoleteOptionalNodeIds: []
};
const context = {
    activeQuestion: { id: 'q1', text: 'How does it work?' },
    memory: { coveredClaims: [], declinedTopics: [] }
};

describe('model plan critique', () => {
    it('drops only a selected optional demo and keeps private URL/evidence out of input', async () => {
        const complete = vi.fn(async () => ({ text: JSON.stringify({
            dropNodeIds: ['demo'], issueCode: 'unnecessary_demo'
        }) }));
        const onAssessment = vi.fn();
        const invoke = createModelPlanCritiqueInvocation({ complete, onAssessment });
        const revised = await invoke({ model: 'test-model', proposal, context });
        expect(revised.proposedNodes.map((step) => step.id))
            .toEqual(['answer', 'check', 'closing']);
        expect(onAssessment).toHaveBeenCalledWith({
            issueCode: 'unnecessary_demo', droppedNodeCount: 1
        });
        expect(complete.mock.calls[0][0].responseFormat)
            .toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    });

    it.each([
        { dropNodeIds: ['answer'], issueCode: 'irrelevant' },
        { dropNodeIds: ['closing'], issueCode: 'irrelevant' },
        { dropNodeIds: ['demo', 'demo'], issueCode: 'repetitive' },
        { dropNodeIds: ['check'], issueCode: 'unnecessary_demo' },
        { dropNodeIds: [], issueCode: 'repetitive' }
    ])('rejects an unsafe critique: %j', async (critique) => {
        const invoke = createModelPlanCritiqueInvocation({
            complete: async () => ({ text: JSON.stringify(critique) })
        });
        await expect(invoke({ model: 'test', proposal, context })).rejects.toThrow();
    });

    it('keeps the original proposal when the model fails in the middleware', async () => {
        const reviewer = createModelPlanReviewer({
            model: 'test',
            invoke: createModelPlanCritiqueInvocation({
                complete: async () => ({ text: 'not-json' })
            })
        });
        const pipeline = createPlanMiddlewarePipeline({ middlewares: [reviewer] });
        const result = await pipeline.review({ proposal, context });
        expect(result.proposal.proposedNodes.map((step) => step.id))
            .toEqual(['answer', 'demo', 'check', 'closing']);
        expect(result.reviews).toEqual([{
            middlewareId: 'model_critic', status: 'skipped_error'
        }]);
    });
});
