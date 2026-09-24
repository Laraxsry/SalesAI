import { describe, expect, it, vi } from 'vitest';
import { createModelPlanReviewer } from './model-plan-reviewer.js';

describe('model plan reviewer adapter', () => {
    it('keeps provider invocation behind a configured middleware port', async () => {
        const invoke = vi.fn(async ({ proposal }) => proposal);
        const middleware = createModelPlanReviewer({
            model: 'critic-model-v1',
            invoke,
            timeoutMs: 250
        });
        const proposal = { proposedNodes: [] };
        const context = { sessionId: 'session' };

        await middleware.review(proposal, context);
        expect(invoke).toHaveBeenCalledWith({
            model: 'critic-model-v1',
            proposal,
            context
        });
        expect(middleware.timeoutMs).toBe(250);
    });

    it('requires explicit model and invocation configuration', () => {
        expect(() => createModelPlanReviewer({ model: '', invoke: () => {} })).toThrow(TypeError);
        expect(() => createModelPlanReviewer({ model: 'critic-model-v1' })).toThrow(TypeError);
    });
});
