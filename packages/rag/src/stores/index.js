import { withFallback } from '@repo/resilience';
import { MongoVectorStore } from './mongo.store.js';
import { QdrantVectorStore } from './qdrant.store.js';

const STORE_FACTORIES = {
    mongodb: () => new MongoVectorStore(),
    qdrant: () => new QdrantVectorStore()
};

const instances = new Map();
function getStoreInstance(name) {
    if (!instances.has(name)) instances.set(name, STORE_FACTORIES[name]());
    return instances.get(name);
}

/**
 * Returns the configured vector store (strategy pattern).
 * VECTOR_STORE = mongodb (Atlas Vector Search) | qdrant
 *
 * Phase 7: `query()` — the read path — tries `VECTOR_STORE_FALLBACK_CHAIN`
 * in order (default: the configured store, then the other one), with
 * timeout + jittered retry + circuit breaker via `@repo/resilience`.
 *
 * `upsert`/`deleteBySource`/`keywordQuery` deliberately do NOT fall back:
 * they always target the primary (`VECTOR_STORE`) store only. Falling a
 * write back to a different store would silently split product knowledge
 * between two databases with no path to reconcile them later — a write
 * failure should surface (it already does, via the existing KnowledgeSource
 * `status: 'failed'` + BullMQ retry from Phase 1), not be papered over.
 */
export function getVectorStore() {
    const primaryName = process.env.VECTOR_STORE || 'mongodb';
    const chain = (
        process.env.VECTOR_STORE_FALLBACK_CHAIN || `${primaryName},${primaryName === 'mongodb' ? 'qdrant' : 'mongodb'}`
    ).split(',');
    const primary = getStoreInstance(primaryName);

    return {
        query: (args) =>
            withFallback({
                capability: 'vector-store',
                providers: chain,
                invoke: (name) => getStoreInstance(name).query(args)
            }),
        keywordQuery: primary.keywordQuery ? (args) => primary.keywordQuery(args) : undefined,
        upsert: (items) => primary.upsert(items),
        deleteBySource: (sourceId) => primary.deleteBySource(sourceId)
    };
}
