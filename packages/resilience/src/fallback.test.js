import { describe, it, expect, vi, afterEach } from 'vitest';
import { withFallback } from './fallback.js';
import { getBreaker, _resetRegistry } from './circuit-breaker.js';

// No retry delay to keep these deterministic and instant — retry's own
// backoff/jitter behavior is covered by retry.test.js.
const NO_RETRY = { attempts: 1 };

describe('withFallback', () => {
    afterEach(() => _resetRegistry());

    it('returns the first provider\'s result without trying the rest', async () => {
        const invoke = vi.fn().mockResolvedValue('result-from-a');
        const result = await withFallback({
            capability: 'test-1',
            providers: ['a', 'b'],
            invoke,
            retry: NO_RETRY
        });
        expect(result).toBe('result-from-a');
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith('a');
    });

    it('falls through to the next provider when the first fails', async () => {
        const invoke = vi.fn((name) => (name === 'a' ? Promise.reject(new Error('a is down')) : Promise.resolve('result-from-b')));
        const result = await withFallback({
            capability: 'test-2',
            providers: ['a', 'b'],
            invoke,
            retry: NO_RETRY
        });
        expect(result).toBe('result-from-b');
        expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('skips a provider whose circuit is already open, without calling invoke', async () => {
        // Force provider "a"'s breaker open ahead of time.
        const breaker = getBreaker('test-3:a', { failureThreshold: 1 });
        breaker.onFailure();
        expect(breaker.getState()).toBe('open');

        const invoke = vi.fn().mockResolvedValue('result-from-b');
        const result = await withFallback({
            capability: 'test-3',
            providers: ['a', 'b'],
            invoke,
            retry: NO_RETRY
        });
        expect(result).toBe('result-from-b');
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith('b');
    });

    it('throws an AggregateError listing every provider\'s failure when the whole chain is exhausted', async () => {
        const invoke = vi.fn().mockRejectedValue(new Error('down'));
        await expect(
            withFallback({ capability: 'test-4', providers: ['a', 'b'], invoke, retry: NO_RETRY })
        ).rejects.toThrow(AggregateError);

        try {
            await withFallback({ capability: 'test-4', providers: ['a', 'b'], invoke, retry: NO_RETRY });
            expect.unreachable();
        } catch (err) {
            expect(err.errors).toHaveLength(2);
        }
    });

    it('a later success closes a previously-open circuit for that provider', async () => {
        const breaker = getBreaker('test-5:a', { failureThreshold: 1, resetTimeoutMs: 0 });
        breaker.onFailure();
        expect(breaker.getState()).toBe('open');

        const invoke = vi.fn().mockResolvedValue('recovered');
        const result = await withFallback({
            capability: 'test-5',
            providers: ['a'],
            invoke,
            retry: NO_RETRY,
            breaker: { resetTimeoutMs: 0 }
        });
        expect(result).toBe('recovered');
        expect(breaker.getState()).toBe('closed');
    });
});
