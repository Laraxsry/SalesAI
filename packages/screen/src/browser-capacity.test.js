import { describe, expect, it } from 'vitest';
import { BrowserCapacity } from './browser-capacity.js';

describe('BrowserCapacity', () => {
    it('shares a strict lease limit and releases capacity idempotently', () => {
        const capacity = new BrowserCapacity({ limit: 1 });
        const first = {};
        const second = {};

        capacity.acquire(first, 'First');
        capacity.acquire(first, 'First');
        expect(() => capacity.acquire(second, 'Second')).toThrow(/limit reached \(1\)/);

        capacity.release(first);
        capacity.release(first);
        expect(() => capacity.acquire(second, 'Second')).not.toThrow();
    });
});
