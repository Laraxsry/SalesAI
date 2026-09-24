import { describe, expect, it } from 'vitest';
import {
    createPlanMiddlewareExperimentGate, reviewerExperimentPercent
} from './plan-middleware-experiment.js';
import { createPlanMiddlewarePipeline } from './plan-middleware-pipeline.js';
import { createRepetitionPlanReviewer } from './repetition-plan-reviewer.js';

describe('plan middleware experiment gate', () => {
    it('supports explicit off and full-rollout configurations', () => {
        expect(createPlanMiddlewareExperimentGate({
            rolloutPercent: 0, experimentId: 'critic-v1'
        })({ sessionId: 's1' })).toBe(false);
        expect(createPlanMiddlewareExperimentGate({
            rolloutPercent: 100, experimentId: 'critic-v1'
        })({ sessionId: 's1' })).toBe(true);
    });

    it('assigns the same session deterministically', () => {
        const gate = createPlanMiddlewareExperimentGate({
            rolloutPercent: 50, experimentId: 'critic-v1'
        });
        const first = gate({ sessionId: 'stable-session' });
        expect(gate({ sessionId: 'stable-session' })).toBe(first);
    });

    it('requires an experiment id so unrelated tests cannot share a bucket accidentally', () => {
        expect(() => createPlanMiddlewareExperimentGate({ rolloutPercent: 50 })).toThrow(TypeError);
    });

    it('keeps the reviewer on by default and fails closed on malformed config', () => {
        expect(reviewerExperimentPercent(undefined)).toBe(100);
        expect(reviewerExperimentPercent('20')).toBe(20);
        expect(reviewerExperimentPercent('not-a-percent')).toBe(0);
        expect(reviewerExperimentPercent('120')).toBe(0);
    });

    it('skips the repetition reviewer without changing the planned route', async () => {
        const decisions = [];
        const proposal = {
            baseRevision: 0, planningGeneration: 1, reason: 'customer_question',
            proposedNodes: [{ id: 'check', type: 'check', objective: 'Kontrol et',
                deliveryIntent: 'direct_answer' }]
        };
        const review = (percent) => createPlanMiddlewarePipeline({
            middlewares: [createRepetitionPlanReviewer({
                enabled: createPlanMiddlewareExperimentGate({
                    experimentId: 'repetition-reviewer-v1', rolloutPercent: percent
                }),
                onDecision: (decision) => decisions.push(decision)
            })]
        }).review({ proposal, context: { sessionId: 'session-a', obligations: {},
            memory: { coveredClaims: [], declinedTopics: [], turnIndex: 0 } } });
        const disabled = await review(0);
        expect(disabled.reviews).toEqual([{
            middlewareId: 'repetition', status: 'skipped_disabled'
        }]);
        expect(disabled.proposal.proposedNodes).toHaveLength(1);
        expect(decisions).toHaveLength(0);
        const enabled = await review(100);
        expect(enabled.reviews[0].status).toBe('passed');
        expect(decisions).toHaveLength(1);
    });
});
