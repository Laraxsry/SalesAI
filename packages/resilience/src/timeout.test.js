import { describe, it, expect, vi } from 'vitest';
import { withTimeout } from './timeout.js';

describe('withTimeout', () => {
    it('resolves normally when fn finishes before the deadline', async () => {
        const result = await withTimeout(() => Promise.resolve('ok'), 1000);
        expect(result).toBe('ok');
    });

    it('rejects with the original error when fn rejects before the deadline', async () => {
        await expect(withTimeout(() => Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
    });

    it('rejects with a timeout error when fn never settles in time', async () => {
        vi.useFakeTimers();
        const hung = () => new Promise(() => {}); // never resolves
        const promise = withTimeout(hung, 50);
        vi.advanceTimersByTime(50);
        await expect(promise).rejects.toThrow('Timed out after 50ms');
        vi.useRealTimers();
    });
});
