import { describe, it, expect } from 'vitest';
import { MongoVectorStore } from './mongo.store.js';
import { getVectorStore } from './index.js';

/**
 * getVectorStore() is a hand-written facade (deliberately, per the comment
 * in index.js: query() gets fallback-chain resilience, writes stay
 * primary-only) — NOT a transparent proxy over the underlying store class.
 * Every time a method is added to *.store.js it also has to be added here
 * by hand, or callers get "store.xxx is not a function" — exactly what
 * happened when `listBySource`/`deleteByIds` were added to
 * MongoVectorStore/QdrantVectorStore for `reingestSourceIncremental()`
 * (packages/rag/src/ingest.js) but the facade forwarding it was forgotten.
 * This asserts every method on the store class prototype the default
 * VECTOR_STORE (mongodb) resolves to is actually reachable through
 * getVectorStore() — a real integration test would have caught the
 * original bug (it only reached `store.listBySource is not a function` in
 * production against a live Mongo, past every mocked unit test).
 */
describe('getVectorStore() facade completeness', () => {
    it('forwards every MongoVectorStore method', () => {
        const store = getVectorStore();
        const methodNames = Object.getOwnPropertyNames(MongoVectorStore.prototype).filter(
            (name) => name !== 'constructor'
        );
        for (const name of methodNames) {
            expect(typeof store[name], `getVectorStore() is missing "${name}"`).toBe('function');
        }
    });
});
