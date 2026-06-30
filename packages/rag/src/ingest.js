import { embedBatch } from '@repo/ai';
import { KnowledgeSource } from '@repo/database';
import { chunkText } from './chunk.js';
import { getVectorStore } from './stores/index.js';

/**
 * Ingests a single knowledge source: builds text (already extracted by the
 * worker for video/image/url), chunks it, embeds it, and upserts vectors.
 *
 * @param {{ sourceId:string, productId:string, text:string, modality?:string, metadata?:object }} input
 */
export async function ingestSource({ sourceId, productId, text, modality = 'text', metadata = {} }) {
    const store = getVectorStore();
    await KnowledgeSource.findByIdAndUpdate(sourceId, { status: 'processing' });

    try {
        await store.deleteBySource(sourceId);

        const chunks = chunkText(text);
        if (!chunks.length) {
            await KnowledgeSource.findByIdAndUpdate(sourceId, { status: 'ready' });
            return { chunks: 0 };
        }

        const embeddings = await embedBatch(chunks);
        const items = chunks.map((c, i) => ({
            productId,
            sourceId,
            text: c,
            embedding: embeddings[i],
            modality,
            metadata
        }));

        await store.upsert(items);
        await KnowledgeSource.findByIdAndUpdate(sourceId, { status: 'ready' });
        return { chunks: items.length };
    } catch (err) {
        await KnowledgeSource.findByIdAndUpdate(sourceId, {
            status: 'failed',
            error: err.message
        });
        throw err;
    }
}
