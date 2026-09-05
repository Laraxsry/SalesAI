import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {
    listByProduct: vi.fn(),
    upsert: vi.fn(),
    setStatus: vi.fn()
};
const embed = vi.fn();
const clusterChunks = vi.fn();
const reviewCluster = vi.fn();
const knowledgeAuditCreate = vi.fn();

vi.mock('@repo/ai', () => ({ embed: (...a) => embed(...a) }));
vi.mock('@repo/logger', () => ({ Logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../stores/index.js', () => ({ getVectorStore: () => store }));
vi.mock('./cluster.js', () => ({ clusterChunks: (...a) => clusterChunks(...a) }));
vi.mock('./review.js', () => ({ reviewCluster: (...a) => reviewCluster(...a) }));
vi.mock('@repo/database', () => ({
    KnowledgeAudit: { create: (...a) => knowledgeAuditCreate(...a) },
    KnowledgeSource: { findById: () => ({ select: () => ({ lean: async () => ({ title: 'Test source' }) }) }) }
}));

const { autoDedupeSourceChunks } = await import('./auto-dedupe.js');

const CHUNKS = [
    { id: 'c1', text: 'A', embedding: [0.1], sourceId: 'src1' },
    { id: 'c2', text: 'B', embedding: [0.1], sourceId: 'src1' }
];

beforeEach(() => {
    vi.clearAllMocks();
    store.listByProduct.mockResolvedValue(CHUNKS);
    store.upsert.mockResolvedValue(['curated-1']);
    store.setStatus.mockResolvedValue(1);
    embed.mockResolvedValue([0.2]);
});

describe('autoDedupeSourceChunks', () => {
    it('does nothing when there are fewer than 2 chunks', async () => {
        store.listByProduct.mockResolvedValue([CHUNKS[0]]);

        await autoDedupeSourceChunks({ productId: 'prod1', sourceId: 'src1' });

        expect(clusterChunks).not.toHaveBeenCalled();
    });

    it('does nothing when clustering finds no candidates', async () => {
        clusterChunks.mockReturnValue({ clusters: [] });

        await autoDedupeSourceChunks({ productId: 'prod1', sourceId: 'src1' });

        expect(reviewCluster).not.toHaveBeenCalled();
    });

    // Katman 2's whole safety property: only a reviewer-confirmed "duplicate"
    // is ever auto-applied. Similarity alone (clusterChunks' job) never
    // decides this — a price/contact-detail contradiction can score HIGHER
    // than a harmless duplicate (see auto-dedupe.js's own doc comment).
    it('auto-applies a "duplicate" verdict with a canonical rewrite, and never touches KnowledgeAudit', async () => {
        clusterChunks.mockReturnValue({ clusters: [{ chunkIds: ['c1', 'c2'], similarity: 0.98 }] });
        reviewCluster.mockResolvedValue({
            verdict: 'duplicate',
            summary: 'Same info, reworded',
            rationale: '...',
            keepChunkId: null,
            canonicalText: 'Merged text'
        });

        await autoDedupeSourceChunks({ productId: 'prod1', sourceId: 'src1' });

        expect(embed).toHaveBeenCalledWith('Merged text');
        expect(store.upsert).toHaveBeenCalledWith([
            expect.objectContaining({ productId: 'prod1', sourceId: 'src1', text: 'Merged text' })
        ]);
        expect(store.setStatus).toHaveBeenCalledWith({
            ids: ['c1', 'c2'],
            status: 'superseded',
            supersededBy: 'curated-1'
        });
        expect(knowledgeAuditCreate).not.toHaveBeenCalled();
    });

    it('auto-applies a "duplicate" verdict with only a keepChunkId (no rewrite), retiring the rest', async () => {
        clusterChunks.mockReturnValue({ clusters: [{ chunkIds: ['c1', 'c2'], similarity: 0.98 }] });
        reviewCluster.mockResolvedValue({
            verdict: 'duplicate',
            summary: 'Identical',
            rationale: '...',
            keepChunkId: 'c1',
            canonicalText: null
        });

        await autoDedupeSourceChunks({ productId: 'prod1', sourceId: 'src1' });

        expect(embed).not.toHaveBeenCalled();
        expect(store.setStatus).toHaveBeenCalledWith({ ids: ['c2'], status: 'superseded', supersededBy: 'c1' });
    });

    // The one verdict this must NEVER auto-resolve — deciding which of two
    // conflicting facts (a price, a phone number) is true is a business call.
    it('never auto-applies a "contradiction" — records it as a pending KnowledgeAudit instead', async () => {
        clusterChunks.mockReturnValue({ clusters: [{ chunkIds: ['c1', 'c2'], similarity: 0.95 }] });
        reviewCluster.mockResolvedValue({
            verdict: 'contradiction',
            summary: 'Different prices for the same plan',
            rationale: '...',
            keepChunkId: 'c1',
            canonicalText: null
        });

        await autoDedupeSourceChunks({ productId: 'prod1', sourceId: 'src1' });

        expect(store.setStatus).not.toHaveBeenCalled();
        expect(store.upsert).not.toHaveBeenCalled();
        expect(knowledgeAuditCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                productId: 'prod1',
                status: 'ready',
                findings: [expect.objectContaining({ type: 'contradiction', decision: 'pending', chunkIds: ['c1', 'c2'] })]
            })
        );
    });

    it('never throws — a failure here must not fail an otherwise-successful ingestion', async () => {
        clusterChunks.mockImplementation(() => {
            throw new Error('boom');
        });

        await expect(autoDedupeSourceChunks({ productId: 'prod1', sourceId: 'src1' })).resolves.toBeUndefined();
    });
});
