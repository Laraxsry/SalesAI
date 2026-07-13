import { embed } from '@repo/ai';
import { getVectorStore } from './stores/index.js';
import IORedis from 'ioredis';

// Reuse a single Redis connection
let redisClient = null;
function getRedis() {
    if (!redisClient) {
        redisClient = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: 1,
            enableReadyCheck: false
        });
        redisClient.on('error', () => {}); // Prevent unhandled errors
    }
    return redisClient;
}

/**
 * Normalizes a query for caching (removes extra spaces, makes lowercase).
 */
function normalizeQuery(query) {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Retrieves the most relevant knowledge chunks for a query.
 * Caches results per (productId, normalized query) in Redis.
 * @param {{ productId:string, query:string, topK?:number, modality?:string }} input
 * @returns {Promise<Array<{id:string, sourceId:string, text:string, score:number}>>}
 */
export async function retrieve({ productId, query, topK = 8, modality }) {
    const redis = getRedis();
    const normalized = normalizeQuery(query);
    const modalityKey = modality ? `:${modality}` : '';
    const cacheKey = `rag:cache:${productId}:${normalized}:${topK}${modalityKey}`;

    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (err) {
        // Ignore cache read errors, fallback to regular retrieval
    }

    const embedding = await embed(query);
    const store = getVectorStore();
    
    // Run Vector Search and BM25 Search concurrently
    const [vectorResults, keywordResults] = await Promise.all([
        store.query({ productId, embedding, topK, modality }),
        // Check if keywordQuery exists (e.g. Qdrant store might not have it yet)
        store.keywordQuery 
            ? store.keywordQuery({ productId, query, topK, modality })
            : Promise.resolve([])
    ]);

    // Merge and deduplicate by chunk ID
    const map = new Map();
    for (const r of [...vectorResults, ...keywordResults]) {
        if (!map.has(r.id)) {
            map.set(r.id, r);
        }
    }
    const mergedResults = Array.from(map.values());

    // Rerank using Cross-Encoder
    // Dynamic import to avoid loading transformers if not needed immediately
    const { rerank } = await import('@repo/ai');
    const rerankedResults = await rerank(query, mergedResults, topK);

    try {
        // Cache for 24 hours (86400 seconds)
        await redis.setex(cacheKey, 86400, JSON.stringify(rerankedResults));
    } catch (err) {
        // Ignore cache write errors
    }

    return rerankedResults;
}
