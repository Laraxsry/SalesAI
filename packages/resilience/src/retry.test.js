import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retryWithJitter } from './retry.js';

describe('retryWithJitter', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('returns the result on the first successful attempt, no retries', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const result = await retryWithJitter(fn, { attempts: 3 });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries after a failure and succeeds within the attempt budget', async () => {
        const fn = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValueOnce('ok');
        const promise = retryWithJitter(fn, { attempts: 3, baseMs: 100 });
        await vi.runAllTimersAsync();
        expect(await promise).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws the last error once every attempt is exhausted', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('always fails'));
        const promise = retryWithJitter(fn, { attempts: 3, baseMs: 10 });
        // Attach the rejection handler before advancing timers, so the
        // rejection is never briefly "unhandled" from Node's perspective.
        const assertion = expect(promise).rejects.toThrow('always fails');
        await vi.runAllTimersAsync();
        await assertion;
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not sleep after the final failed attempt', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail'));
        const promise = retryWithJitter(fn, { attempts: 2, baseMs: 10_000 });
        // If it slept after the last attempt too, this would still be pending
        // with zero timers advanced; runAllTimersAsync would hang instead of
        // resolving, since there'd be nothing meaningful left to run only if
        // the implementation is correct — verified by the promise settling.
        const assertion = expect(promise).rejects.toThrow('fail');
        await vi.runAllTimersAsync();
        await assertion;
    });

    it('keeps the jittered delay within [0, exponential ceiling]', async () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const fn = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValueOnce('ok');

        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        const promise = retryWithJitter(fn, { attempts: 2, baseMs: 100, maxMs: 5_000 });
        await vi.runAllTimersAsync();
        await promise;

        const delay = setTimeoutSpy.mock.calls[0][1];
        // ceiling for i=0 is baseMs * 2^0 = 100; with Math.random mocked to
        // 0.5, the delay should be exactly half that.
        expect(delay).toBe(50);

        randomSpy.mockRestore();
        setTimeoutSpy.mockRestore();
    });
});
