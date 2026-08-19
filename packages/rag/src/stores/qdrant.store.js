import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'node:crypto';

const COLLECTION = 'knowledge_chunks';

/** @see MongoVectorStore — same over-fetch/retired-status contract. */
const OVERFETCH = 3;
const RETIRED = new Set(['superseded', 'excluded']);

/** Vector store backed by Qdrant (scale / alternative to Atlas Vector Search). */
export class QdrantVectorStore {
    constructor() {
        this.client = new QdrantClient({
            url: process.env.QDRANT_URL || 'http://localhost:6333',
            apiKey: process.env.QDRANT_API_KEY
        });
    }

    async ensureCollection(dim = Number(process.env.EMBEDDING_DIM || 3072)) {
        const exists = await this.client
            .getCollection(COLLECTION)
            .then(() => true)
            .catch(() => false);
        if (!exists) {
            await this.client.createCollection(COLLECTION, {
                vectors: { size: dim, distance: 'Cosine' }
            });
        }
    }

    /** @returns {Promise<string[]>} @see MongoVectorStore#upsert */
    async upsert(items) {
        if (!items.length) return [];
        await this.ensureCollection(items[0].embedding.length);
        const ids = items.map(() => randomUUID());
        await this.client.upsert(COLLECTION, {
            points: items.map((it, i) => ({
                id: ids[i],
                vector: it.embedding,
                payload: {
                    productId: it.productId,
                    sourceId: it.sourceId,
                    text: it.text,
                    modality: it.modality || 'text',
                    audience: it.audience || 'general',
                    status: it.status || 'active',
                    metadata: it.metadata || {}
                }
            }))
        });
        return ids;
    }

    async query({ productId, embedding, topK = 8, modality }) {
        const must = [{ key: 'productId', match: { value: productId } }];
        if (modality) must.push({ key: 'modality', match: { value: modality } });

        const res = await this.client.search(COLLECTION, {
            // Over-fetch, then drop chunks a knowledge audit retired. A
            // `must_not` payload filter would be exact, but points written
            // before the audit feature carry no `status` key at all and Qdrant
            // would still match them — so the drop happens here either way.
            limit: topK * OVERFETCH,
            vector: embedding,
            filter: { must }
        });

        return res
            .filter((r) => !RETIRED.has(r.payload?.status))
            .slice(0, topK)
            .map((r) => ({
                id: String(r.id),
                sourceId: r.payload?.sourceId,
                text: r.payload?.text,
                score: r.score,
                audience: r.payload?.audience,
                metadata: r.payload?.metadata
            }));
    }

    async deleteBySource(sourceId) {
        await this.client.delete(COLLECTION, {
            filter: { must: [{ key: 'sourceId', match: { value: sourceId } }] }
        });
    }

    /** @see MongoVectorStore#listByProduct */
    async listByProduct({ productId, limit = 2000 }) {
        const points = [];
        let offset;
        // `scroll` pages rather than returning everything at once; the vectors
        // are what the audit actually needs, so they must be asked for.
        do {
            const page = await this.client.scroll(COLLECTION, {
                filter: { must: [{ key: 'productId', match: { value: productId } }] },
                with_payload: true,
                with_vector: true,
                limit: Math.min(256, limit - points.length),
                offset
            });
            for (const p of page.points) {
                if (RETIRED.has(p.payload?.status)) continue;
                points.push({
                    id: String(p.id),
                    sourceId: p.payload?.sourceId,
                    text: p.payload?.text,
                    embedding: p.vector,
                    audience: p.payload?.audience
                });
            }
            offset = page.next_page_offset;
        } while (offset && points.length < limit);

        return points;
    }

    /** @see MongoVectorStore#setStatus */
    async setStatus({ ids, status, supersededBy }) {
        if (!ids?.length) return 0;
        await this.client.setPayload(COLLECTION, {
            payload: { status, supersededBy: supersededBy || null },
            points: ids
        });
        return ids.length;
    }
}
