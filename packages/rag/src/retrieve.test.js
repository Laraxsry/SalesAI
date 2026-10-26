import { beforeEach, describe, expect, it, vi } from 'vitest';

const redis = { get: vi.fn(), setex: vi.fn() };
vi.mock('ioredis', () => ({
    // retrieve.js builds its client with `new IORedis(...)`, so the fake must be a constructor.
    default: class FakeRedis {
        constructor() {
            Object.assign(this, redis, { on: vi.fn() });
        }
    }
}));

const store = { query: vi.fn(), keywordQuery: vi.fn() };
vi.mock('./stores/index.js', () => ({ getVectorStore: () => store }));

vi.mock('@repo/ai', () => ({
    embed: vi.fn(async () => [0.1, 0.2]),
    // Order-preserving rerank so the test only observes what retrieve() let through.
    rerank: vi.fn(async (_query, results) => results.map((r) => ({ ...r, score: r.score ?? 0.5 })))
}));

const { retrieve } = await import('./retrieve.js');

const chunk = (id, kind) => ({ id, text: `chunk ${id}`, score: 0.5, ...(kind && { kind }) });

beforeEach(() => {
    vi.clearAllMocks();
    redis.get.mockResolvedValue(null);
    store.query.mockResolvedValue([]);
    store.keywordQuery.mockResolvedValue([]);
});

describe('retrieve — shelf (kind) scope', () => {
    it('asks the stores for product knowledge by default', async () => {
        await retrieve({ productId: 'p1', query: 'fiyat' });

        expect(store.query).toHaveBeenCalledWith(expect.objectContaining({ kind: 'knowledge' }));
        expect(store.keywordQuery).toHaveBeenCalledWith(expect.objectContaining({ kind: 'knowledge' }));
    });

    it('never lets a dashboard chunk through a visitor-facing lookup, even from a store that cannot filter', async () => {
        store.query.mockResolvedValue([chunk('a'), chunk('b', 'ui')]);
        store.keywordQuery.mockResolvedValue([chunk('c', 'ui'), chunk('d', 'knowledge')]);

        const results = await retrieve({ productId: 'p1', query: 'fiyat' });

        expect(results.map((r) => r.id).sort()).toEqual(['a', 'd']);
    });

    it('the ui scope returns only dashboard chunks', async () => {
        store.query.mockResolvedValue([chunk('a'), chunk('b', 'ui')]);

        const results = await retrieve({ productId: 'p1', query: 'create workflow', kind: 'ui' });

        expect(results.map((r) => r.id)).toEqual(['b']);
        expect(store.query).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ui' }));
    });

    it('caches each shelf separately, so a dashboard answer is never served for a knowledge question', async () => {
        await retrieve({ productId: 'p1', query: 'same question' });
        await retrieve({ productId: 'p1', query: 'same question', kind: 'ui' });

        const keys = redis.setex.mock.calls.map((call) => call[0]);
        expect(new Set(keys).size).toBe(2);
    });
});
