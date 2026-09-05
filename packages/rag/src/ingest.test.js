import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@repo/database', () => ({
    KnowledgeSource: { findByIdAndUpdate: vi.fn() }
}));
vi.mock('@repo/ai', () => ({
    embedBatch: vi.fn(),
    // classifyAudience() falls back to 'general' for every chunk on any
    // failure (packages/rag/src/ingest.js) — an empty-labels response
    // triggers that fallback cleanly without needing a real LLM call.
    getLLM: () => ({ complete: vi.fn().mockResolvedValue({ text: '{"labels":[]}' }) })
}));

const store = {
    listBySource: vi.fn(),
    deleteByIds: vi.fn(),
    deleteBySource: vi.fn(),
    upsert: vi.fn()
};
vi.mock('./stores/index.js', () => ({ getVectorStore: () => store }));

// Katman 2 (near-duplicate/contradiction review) is exercised on its own in
// auto-dedupe.test.js — mocked here so ingest.js's own tests aren't coupled
// to it and stay silent instead of hitting a real, unmocked reviewCluster().
const autoDedupeSourceChunks = vi.fn();
vi.mock('./audit/auto-dedupe.js', () => ({ autoDedupeSourceChunks: (...a) => autoDedupeSourceChunks(...a) }));

const { KnowledgeSource } = await import('@repo/database');
const { embedBatch } = await import('@repo/ai');
const { reingestSourceIncremental, ingestSource } = await import('./ingest.js');

// Long enough per-sentence text that chunkText() (maxChars:1200) keeps each
// sentence as its own chunk rather than merging them — makes the diff
// exercise real chunk boundaries instead of collapsing everything into one.
const pad = (s) => s + ' '.repeat(50) + '.';
const SENTENCE_A = pad('Sentence about the first topic entirely on its own');
const SENTENCE_B = pad('Sentence about the second topic entirely on its own');
const SENTENCE_C = pad('Sentence about the third topic entirely on its own');

beforeEach(() => {
    vi.clearAllMocks();
    embedBatch.mockImplementation(async (chunks) => chunks.map(() => new Array(4).fill(0)));
});

describe('reingestSourceIncremental', () => {
    it('only re-embeds the chunk that changed, leaving unchanged chunks untouched', async () => {
        const oldText = `${SENTENCE_A} ${SENTENCE_B} ${SENTENCE_C}`;
        const editedSentenceB = pad('Sentence about the second topic, now edited');
        const newText = `${SENTENCE_A} ${editedSentenceB} ${SENTENCE_C}`;

        // Stored chunks match exactly what chunkText(oldText) would produce —
        // the precondition for the partial path to run at all.
        const { chunkText } = await import('./chunk.js');
        const oldChunks = chunkText(oldText);
        store.listBySource.mockResolvedValue(oldChunks.map((text, i) => ({ id: `id-${i}`, text })));

        await reingestSourceIncremental({
            sourceId: 'src1',
            productId: 'prod1',
            oldText,
            newText
        });

        // Only the edited chunk was embedded — not the whole document.
        expect(embedBatch).toHaveBeenCalledTimes(1);
        const embedded = embedBatch.mock.calls[0][0];
        expect(embedded.length).toBe(1);
        expect(embedded[0]).toContain('now edited');

        // Scoped delete (by id), never the nuke-everything delete.
        expect(store.deleteBySource).not.toHaveBeenCalled();
        expect(store.deleteByIds).toHaveBeenCalledTimes(1);

        expect(KnowledgeSource.findByIdAndUpdate).toHaveBeenCalledWith('src1', { status: 'ready' });
    });

    it('does nothing (no embed, no delete) when the edit is a no-op', async () => {
        const text = `${SENTENCE_A} ${SENTENCE_B}`;
        const { chunkText } = await import('./chunk.js');
        const chunks = chunkText(text);
        store.listBySource.mockResolvedValue(chunks.map((t, i) => ({ id: `id-${i}`, text: t })));

        await reingestSourceIncremental({ sourceId: 'src1', productId: 'prod1', oldText: text, newText: text });

        expect(embedBatch).not.toHaveBeenCalled();
        expect(store.deleteByIds).not.toHaveBeenCalled();
        expect(store.upsert).not.toHaveBeenCalled();
    });

    it('falls back to a full re-ingest when the stored chunks do not match the old text', async () => {
        // Stored chunks don't correspond to chunkText(oldText) at all — the
        // safety net must refuse to trust a partial diff.
        store.listBySource.mockResolvedValue([{ id: 'stale-id', text: 'totally unrelated stored chunk' }]);

        const oldText = `${SENTENCE_A} ${SENTENCE_B}`;
        const newText = `${SENTENCE_A} ${SENTENCE_C}`;

        await reingestSourceIncremental({ sourceId: 'src1', productId: 'prod1', oldText, newText });

        // Fell through to ingestSource()'s full-replace behavior: nuke everything,
        // embed the entire new text, never touch deleteByIds.
        expect(store.deleteBySource).toHaveBeenCalledWith('src1');
        expect(store.deleteByIds).not.toHaveBeenCalled();
        const embedded = embedBatch.mock.calls.flatMap((call) => call[0]);
        const { chunkText } = await import('./chunk.js');
        expect(embedded.length).toBe(chunkText(newText).length);
    });
});

describe('ingestSource — Katman 1 (exact-duplicate collapse)', () => {
    it('embeds a chunk that repeats verbatim across pages only once', async () => {
        // Real observed shape: the same rendered DOM block (a repeated UI
        // widget/section) shows up byte-identical on more than one crawled
        // page — modeled here as its own segment appearing twice, alongside
        // each page's genuinely unique content in a separate segment.
        const shared = pad('This exact sentence is repeated verbatim on multiple pages');
        const onlyOnA = pad('Something that only appears on page A');
        const onlyOnB = pad('Something that only appears on page B');

        await ingestSource({
            sourceId: 'src1',
            productId: 'prod1',
            text: [
                { text: shared, metadata: { pageUrl: '/a' } },
                { text: onlyOnA, metadata: { pageUrl: '/a' } },
                { text: shared, metadata: { pageUrl: '/b' } },
                { text: onlyOnB, metadata: { pageUrl: '/b' } }
            ]
        });

        const embedded = embedBatch.mock.calls.flatMap((call) => call[0]);
        expect(embedded.filter((c) => c.includes('repeated verbatim')).length).toBe(1);
        expect(embedded.some((c) => c.includes('only appears on page A'))).toBe(true);
        expect(embedded.some((c) => c.includes('only appears on page B'))).toBe(true);

        // The one surviving copy is still stored — this drops the embedding
        // call for the repeat, not the knowledge itself.
        const upserted = store.upsert.mock.calls[0][0];
        expect(upserted.filter((i) => i.text.includes('repeated verbatim')).length).toBe(1);
    });

    it('is case/whitespace-insensitive but not a fuzzy match', async () => {
        const original = pad('Please contact support for further assistance today');
        const reworded = pad('Please reach out to support if you need more help');

        await ingestSource({
            sourceId: 'src1',
            productId: 'prod1',
            text: [
                { text: original, metadata: { pageUrl: '/a' } },
                { text: reworded, metadata: { pageUrl: '/b' } }
            ]
        });

        // Genuinely different wording is never touched by Katman 1 — that is
        // Katman 2's job (auto-dedupe.js), and only via an LLM verdict.
        const embedded = embedBatch.mock.calls.flatMap((call) => call[0]);
        expect(embedded.length).toBe(2);
    });

    it('runs the Katman 2 review before marking the source ready', async () => {
        await ingestSource({ sourceId: 'src1', productId: 'prod1', text: pad('Some real content here') });

        expect(autoDedupeSourceChunks).toHaveBeenCalledWith({ productId: 'prod1', sourceId: 'src1' });
        const statusCalls = KnowledgeSource.findByIdAndUpdate.mock.calls.map((c) => c[1]?.status).filter(Boolean);
        expect(statusCalls.at(-1)).toBe('ready');
    });
});
