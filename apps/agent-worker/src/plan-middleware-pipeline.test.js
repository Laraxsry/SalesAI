import { describe, expect, it, vi } from 'vitest';
import { createPlanMiddlewarePipeline } from './plan-middleware-pipeline.js';

function proposal() {
    return {
        baseRevision: 0,
        planningGeneration: 1,
        reason: 'question',
        proposedNodes: [{ id: 'check', type: 'check', objective: 'Kontrol et' }]
    };
}

describe('plan middleware pipeline', () => {
    it('preserves exact behavior when the chain is empty', async () => {
        const original = proposal();
        const result = await createPlanMiddlewarePipeline().review({ proposal: original, context: {} });
        expect(result.proposal).toBe(original);
        expect(result.reviews).toEqual([]);
    });

    it('runs enabled reviewers in order and passes revisions forward', async () => {
        const seen = [];
        const pipeline = createPlanMiddlewarePipeline({
            middlewares: [
                {
                    id: 'first',
                    review: (current) => ({ ...current, reason: 'revised_by_first' })
                },
                {
                    id: 'second',
                    review: (current) => {
                        seen.push(current.reason);
                        return current;
                    }
                }
            ]
        });

        const result = await pipeline.review({ proposal: proposal(), context: {} });
        expect(seen).toEqual(['revised_by_first']);
        expect(result.reviews.map((review) => review.status)).toEqual(['revised', 'passed']);
    });

    it('fails open on timeout, error, invalid output and disabled middleware', async () => {
        vi.useFakeTimers();
        const pipeline = createPlanMiddlewarePipeline({
            defaultTimeoutMs: 20,
            middlewares: [
                { id: 'timeout', review: () => new Promise(() => {}) },
                { id: 'error', review: () => { throw new Error('critic offline'); } },
                { id: 'invalid', review: () => ({ broken: true }) },
                { id: 'disabled', enabled: () => false, review: () => { throw new Error('must not run'); } }
            ]
        });
        const pending = pipeline.review({ proposal: proposal(), context: {} });
        await vi.advanceTimersByTimeAsync(20);
        const result = await pending;
        vi.useRealTimers();

        expect(result.reviews.map((review) => review.status)).toEqual([
            'skipped_timeout', 'skipped_error', 'skipped_invalid_output', 'skipped_disabled'
        ]);
        expect(result.proposal.reason).toBe('question');
    });

    it('prevents a reviewer from mutating proposal input in place', async () => {
        const pipeline = createPlanMiddlewarePipeline({
            middlewares: [{
                id: 'mutator',
                review: (current) => {
                    current.reason = 'tampered';
                    return current;
                }
            }]
        });
        const result = await pipeline.review({ proposal: proposal(), context: {} });
        expect(result.reviews[0].status).toBe('skipped_error');
        expect(result.proposal.reason).toBe('question');
    });
});
