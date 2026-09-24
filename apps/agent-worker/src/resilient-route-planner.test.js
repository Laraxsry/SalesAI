import { describe, expect, it, vi } from 'vitest';
import { createResilientRoutePlanner, RoutePlannerTimeoutError } from './resilient-route-planner.js';

describe('resilient route planner', () => {
    it('uses fallback after the primary timeout', async () => {
        vi.useFakeTimers();
        const onFallback = vi.fn();
        const planner = createResilientRoutePlanner({
            primary: { propose: () => new Promise(() => {}) },
            fallback: { propose: () => ({ source: 'fallback' }) },
            timeoutMs: 25,
            onFallback
        });
        const pending = planner.propose({});
        await vi.advanceTimersByTimeAsync(25);

        await expect(pending).resolves.toEqual({ source: 'fallback' });
        expect(onFallback.mock.calls[0][0].error).toBeInstanceOf(RoutePlannerTimeoutError);
        vi.useRealTimers();
    });

    it('uses fallback when the primary throws', async () => {
        const planner = createResilientRoutePlanner({
            primary: { propose: () => { throw new Error('offline'); } },
            fallback: { propose: () => ({ source: 'fallback' }) }
        });
        await expect(planner.propose({})).resolves.toEqual({ source: 'fallback' });
    });
});
