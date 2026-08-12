import { embedBatch, getLLM } from '@repo/ai';
import { KnowledgeSource } from '@repo/database';
import { Logger } from '@repo/logger';
import { chunkText } from './chunk.js';
import { getVectorStore } from './stores/index.js';

/**
 * Classifies each chunk as 'general' or 'technical' in a single LLM call
 * (one call per source, not per chunk, to keep ingestion cost/latency bounded).
 * Falls back to 'general' for every chunk on any failure — never blocks ingestion.
 *
 * @param {string[]} chunks
 * @returns {Promise<('general'|'technical')[]>}
 */
async function classifyAudience(chunks) {
    const fallback = chunks.map(() => 'general');
    try {
        const numbered = chunks.map((c, i) => `[${i}] ${c.slice(0, 800)}`).join('\n\n');
        const llm = getLLM();
        const response = await llm.complete({
            model: 'gpt-4o-mini',
            system: `You classify knowledge-base chunks for a sales assistant by audience depth. For each numbered chunk, decide if it is:
- "general": explains what something is/does, benefits, high-level overview — fine for a non-technical customer
- "technical": implementation details, APIs, configuration, architecture, code — meant for a technical audience

Respond ONLY with valid JSON (no markdown): {"labels": ["general"|"technical", ...]} with exactly one label per chunk, in order.`,
            messages: [{ role: 'user', content: numbered }]
        });
        const parsed = JSON.parse(response.text);
        const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
        if (labels.length !== chunks.length) return fallback;
        return labels.map((l) => (l === 'technical' ? 'technical' : 'general'));
    } catch (err) {
        Logger.warn('[ingest] audience classification başarısız (non-fatal, general varsayılıyor)', {
            error: err?.message
        });
        return fallback;
    }
}

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

        const [embeddings, audiences] = await Promise.all([
            embedBatch(chunks),
            classifyAudience(chunks)
        ]);
        const items = chunks.map((c, i) => ({
            productId,
            sourceId,
            text: c,
            embedding: embeddings[i],
            modality,
            audience: audiences[i],
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
