import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'node:crypto';

const COLLECTION = 'knowledge_chunks';

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

    async upsert(items) {
        if (!items.length) return;
        await this.ensureCollection(items[0].embedding.length);
        await this.client.upsert(COLLECTION, {
            points: items.map((it) => ({
                id: randomUUID(),
                vector: it.embedding,
                payload: {
                    productId: it.productId,
                    sourceId: it.sourceId,
                    text: it.text,
                    modality: it.modality || 'text',
                    metadata: it.metadata || {}
                }
            }))
        });
    }

    async query({ productId, embedding, topK = 8, modality }) {
        const must = [{ key: 'productId', match: { value: productId } }];
        if (modality) must.push({ key: 'modality', match: { value: modality } });

        const res = await this.client.search(COLLECTION, {
            vector: embedding,
            limit: topK,
            filter: { must }
        });

        return res.map((r) => ({
            id: String(r.id),
            sourceId: r.payload?.sourceId,
            text: r.payload?.text,
            score: r.score,
            metadata: r.payload?.metadata
        }));
    }

    async deleteBySource(sourceId) {
        await this.client.delete(COLLECTION, {
            filter: { must: [{ key: 'sourceId', match: { value: sourceId } }] }
        });
    }
}
