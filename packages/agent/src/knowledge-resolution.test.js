import { describe, expect, it, vi } from 'vitest';
import {
    createKnowledgeResolutionIntent,
    createKnowledgeResolver,
    knowledgeResolutionToToolResult
} from './knowledge-resolution.js';

describe('createKnowledgeResolutionIntent', () => {
    it('normalizes questions and creates stable ids', () => {
        const first = createKnowledgeResolutionIntent({ productId: 'p1', query: '  PDF   Aktarma ' });
        const second = createKnowledgeResolutionIntent({ productId: 'p1', query: 'pdf aktarma' });

        expect(first.query).toBe('PDF Aktarma');
        expect(first.intentId).toBe(second.intentId);
    });

    it('bounds topK and rejects empty identity fields', () => {
        expect(createKnowledgeResolutionIntent({ productId: 'p1', query: 'x', topK: 999 }).topK).toBe(50);
        expect(() => createKnowledgeResolutionIntent({ productId: '', query: 'x' })).toThrow('productId');
        expect(() => createKnowledgeResolutionIntent({ productId: 'p1', query: '  ' })).toThrow('query');
    });
});

describe('createKnowledgeResolver', () => {
    it('returns grounded evidence without inventing a demo target', async () => {
        const resolver = createKnowledgeResolver({
            retrieveChunks: vi.fn().mockResolvedValue([
                { id: 'c1', sourceId: 's1', text: 'Doğrulanmış cevap', score: 0.9 }
            ])
        });

        const result = await resolver.resolve({ productId: 'p1', query: 'Soru' });
        expect(result).toMatchObject({
            status: 'grounded',
            knowledgeGap: { status: 'none' },
            demoTargets: []
        });
        expect(result.evidence[0].evidenceId).toBe('knowledge:c1');
    });

    it('extracts and deduplicates verified page/element targets', async () => {
        const metadata = {
            pageUrl: 'https://example.test/import',
            tabLabel: 'PDF',
            elementKey: 'el_1',
            elementPath: 'imports/pdf',
            elementType: 'toggle',
            heading: 'PDF içe aktarma'
        };
        const resolver = createKnowledgeResolver({
            retrieveChunks: vi.fn().mockResolvedValue([
                { id: 'c1', sourceId: 's1', text: 'Bir', score: 0.9, metadata },
                { id: 'c2', sourceId: 's1', text: 'İki', score: 0.8, metadata }
            ])
        });

        const result = await resolver.resolve({ productId: 'p1', query: 'PDF' });
        expect(result.status).toBe('grounded_with_demo');
        expect(result.demoTargets).toEqual([{
            pageUrl: 'https://example.test/import',
            tabLabel: 'PDF',
            elementKey: 'el_1',
            elementPath: 'imports/pdf',
            elementType: 'toggle',
            heading: 'PDF içe aktarma'
        }]);
    });

    it('keeps an empty retrieval as a candidate rather than a confirmed gap', async () => {
        const resolver = createKnowledgeResolver({ retrieveChunks: vi.fn().mockResolvedValue([]) });
        const result = await resolver.resolve({ productId: 'p1', query: 'Bilinmeyen özellik' });

        expect(result).toMatchObject({
            status: 'not_found',
            knowledgeGap: { status: 'candidate', reason: 'no_grounding_evidence' }
        });
    });

    it('does not misclassify infrastructure failures as knowledge gaps', async () => {
        const error = new Error('vector store unavailable');
        const resolver = createKnowledgeResolver({
            retrieveChunks: vi.fn().mockRejectedValue(error)
        });
        const result = await resolver.resolve({ productId: 'p1', query: 'Fiyat' });

        expect(result).toMatchObject({
            status: 'unavailable',
            knowledgeGap: { status: 'none', reason: 'retrieval_unavailable' },
            cause: error
        });
    });

    it('converts evidence back to the established tool result shape', async () => {
        const resolver = createKnowledgeResolver({
            retrieveChunks: vi.fn().mockResolvedValue([{
                id: 'c1',
                sourceId: 's1',
                text: 'Yanıt',
                score: 0.9,
                metadata: { pageUrl: 'https://example.test/faq', elementKey: 'el_1' }
            }])
        });
        const resolution = await resolver.resolve({ productId: 'p1', query: 'Soru' });

        expect(knowledgeResolutionToToolResult(resolution)).toEqual([{
            text: 'Yanıt',
            score: 0.9,
            sourceId: 's1',
            pageUrl: 'https://example.test/faq',
            elementKey: 'el_1'
        }]);
    });
});
