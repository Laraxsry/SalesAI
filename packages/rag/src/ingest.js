import { embedBatch, getLLM } from '@repo/ai';
import { KnowledgeSource } from '@repo/database';
import { Logger } from '@repo/logger';
import { chunkText } from './chunk.js';
import { getVectorStore } from './stores/index.js';
import { diffChunks, multisetEqual, matchTextsToIds } from './chunk-diff.js';

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
 * `text` is normally a single string, but a URL/API crawl passes an array of
 * `{ text, metadata }` segments (one per crawled page) instead — every
 * chunk needs to carry its own `metadata.pageUrl` so the Console detail
 * modal can group chunks under the page they came from, and a multi-page
 * crawl concatenated into one blob before chunking loses that boundary
 * entirely. `deleteBySource()` only runs once regardless (this is still one
 * ingestion pass, not one call per page — a second call would wipe out the
 * previous page's just-inserted chunks).
 *
 * @param {{ sourceId:string, productId:string, text:string|{text:string, metadata?:object}[], modality?:string, metadata?:object }} input
 */
export async function ingestSource({ sourceId, productId, text, modality = 'text', metadata = {} }) {
    const store = getVectorStore();
    await KnowledgeSource.findByIdAndUpdate(sourceId, { status: 'processing' });

    try {
        await store.deleteBySource(sourceId);

        const segments = Array.isArray(text) ? text : [{ text, metadata: {} }];
        const items = [];

        for (const segment of segments) {
            const chunks = chunkText(segment.text);
            if (!chunks.length) continue;

            const [embeddings, audiences] = await Promise.all([
                embedBatch(chunks),
                classifyAudience(chunks)
            ]);
            const segmentMetadata = { ...metadata, ...(segment.metadata || {}) };
            chunks.forEach((c, i) => {
                items.push({
                    productId,
                    sourceId,
                    text: c,
                    embedding: embeddings[i],
                    modality,
                    audience: audiences[i],
                    metadata: segmentMetadata
                });
            });
        }

        if (!items.length) {
            await KnowledgeSource.findByIdAndUpdate(sourceId, { status: 'ready' });
            return { chunks: 0 };
        }

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

/**
 * Re-ingests a source's text after a hand edit (`PATCH /knowledge/:id`),
 * touching only the chunks that actually changed instead of
 * `ingestSource()`'s full delete-everything-and-redo — a small edit to a
 * large document otherwise re-embeds and re-classifies content that never
 * changed, wasting both. `chunkText()` is a deterministic pure function of
 * the whole text (no addressable position), so "which chunks changed" is
 * answered by diffing the chunk arrays produced from the old vs. new text
 * (`diffChunks()`, `chunk-diff.js`) rather than tracking per-chunk offsets.
 *
 * Only single-string `text` sources use this (the Console detail modal's
 * editable types — plain `text` and non-PDF `document` — never produce
 * URL-crawl segments), so unlike `ingestSource()` there's no segment-array
 * input here.
 *
 * Safety net: if what's actually stored for `sourceId` doesn't multiset-
 * match `chunkText(oldText)` (a source ingested before this existed, or a
 * `chunkText()` algorithm change since), a partial diff can't be trusted to
 * identify the right stored chunks — falls back to `ingestSource()`
 * (full re-embed) instead of risking wrong/orphaned chunks.
 *
 * @param {{ sourceId:string, productId:string, oldText:string, newText:string, modality?:string, metadata?:object }} input
 * @returns {Promise<{ chunks:number, reused:number, changed:number }>}
 */
export async function reingestSourceIncremental({ sourceId, productId, oldText, newText, modality = 'text', metadata = {} }) {
    const store = getVectorStore();
    const existing = await store.listBySource(sourceId);
    const oldChunks = chunkText(oldText);

    if (!multisetEqual(existing.map((c) => c.text), oldChunks)) {
        Logger.info('[ingest] partial re-chunk skipped (stored chunks don\'t match old text) — falling back to full re-ingest', {
            sourceId
        });
        const result = await ingestSource({ sourceId, productId, text: newText, modality, metadata });
        return { chunks: result.chunks, reused: 0, changed: result.chunks };
    }

    await KnowledgeSource.findByIdAndUpdate(sourceId, { status: 'processing' });

    try {
        const newChunks = chunkText(newText);
        const { added, removed } = diffChunks(oldChunks, newChunks);

        if (removed.length) {
            await store.deleteByIds(matchTextsToIds(removed, existing));
        }

        if (added.length) {
            const [embeddings, audiences] = await Promise.all([
                embedBatch(added),
                classifyAudience(added)
            ]);
            await store.upsert(
                added.map((c, i) => ({
                    productId,
                    sourceId,
                    text: c,
                    embedding: embeddings[i],
                    modality,
                    audience: audiences[i],
                    metadata
                }))
            );
        }

        await KnowledgeSource.findByIdAndUpdate(sourceId, { status: 'ready' });
        const result = { chunks: newChunks.length, reused: newChunks.length - added.length, changed: added.length };
        Logger.info('[ingest] partial re-chunk', { sourceId, ...result });
        return result;
    } catch (err) {
        await KnowledgeSource.findByIdAndUpdate(sourceId, {
            status: 'failed',
            error: err.message
        });
        throw err;
    }
}
