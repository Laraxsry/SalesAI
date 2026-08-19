import { describe, it, expect, vi, beforeEach } from 'vitest';

const complete = vi.fn();
vi.mock('@repo/ai', () => ({ getLLM: () => ({ complete }) }));
vi.mock('@repo/logger', () => ({ Logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { reviewCluster, reviewJunkBatch } = await import('./review.js');

/** The reviewer answering with `body`, as the provider would return it. */
function answers(body) {
    complete.mockResolvedValue({ text: typeof body === 'string' ? body : JSON.stringify(body) });
}

const pair = [
    { id: 'a', text: 'Başlangıç paketi aylık 500 TL.', sourceTitle: 'eski.pdf' },
    { id: 'b', text: 'Başlangıç paketi aylık 750 TL.', sourceTitle: 'web' }
];

describe('reviewCluster', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.KNOWLEDGE_AUDIT_MODEL;
    });

    it('turns a contradiction verdict into a finding with the chosen chunk', async () => {
        answers({ verdict: 'contradiction', summary: 'Farklı fiyat', rationale: 'neden', keep: 1 });

        expect(await reviewCluster(pair)).toMatchObject({
            verdict: 'contradiction',
            keepChunkId: 'b',
            summary: 'Farklı fiyat'
        });
    });

    it('reports no finding when the reviewer says the group is fine', async () => {
        answers({ verdict: 'fine', summary: 'ok', keep: 0 });
        expect(await reviewCluster(pair)).toBeNull();
    });

    it('reports no finding for a verdict it does not recognise', async () => {
        answers({ verdict: 'maybe-duplicate', keep: 0 });
        expect(await reviewCluster(pair)).toBeNull();
    });

    // Silently falling back to chunks[0] would pick which text survives on the
    // strength of a malformed answer.
    it('refuses an out-of-range keep index instead of defaulting to the first chunk', async () => {
        answers({ verdict: 'duplicate', summary: 's', keep: 7 });
        expect(await reviewCluster(pair)).toBeNull();
    });

    it('still yields a finding when keep is missing but a replacement text was proposed', async () => {
        answers({ verdict: 'duplicate', summary: 's', keep: null, canonicalText: 'Birleşik metin' });

        expect(await reviewCluster(pair)).toMatchObject({
            keepChunkId: null,
            canonicalText: 'Birleşik metin'
        });
    });

    // Without both, applying the finding could only retire chunks — it would
    // delete knowledge and put nothing back.
    it('reports no finding when there is neither a chunk to keep nor a replacement', async () => {
        answers({ verdict: 'duplicate', summary: 's', keep: null, canonicalText: '   ' });
        expect(await reviewCluster(pair)).toBeNull();
    });

    it('tolerates a fenced JSON answer', async () => {
        answers('```json\n{"verdict":"duplicate","summary":"s","keep":0}\n```');
        expect(await reviewCluster(pair)).toMatchObject({ keepChunkId: 'a' });
    });

    it('survives an unparseable answer without throwing', async () => {
        answers('I think these are duplicates.');
        expect(await reviewCluster(pair)).toBeNull();
    });

    it('survives a provider failure without throwing', async () => {
        complete.mockRejectedValue(new Error('502 bad gateway'));
        expect(await reviewCluster(pair)).toBeNull();
    });

    it('does not call the model for a group too small to compare', async () => {
        expect(await reviewCluster([pair[0]])).toBeNull();
        expect(await reviewCluster([])).toBeNull();
        expect(complete).not.toHaveBeenCalled();
    });

    it('asks for the cheap audit model, overridable by env', async () => {
        answers({ verdict: 'fine' });
        await reviewCluster(pair);
        expect(complete.mock.calls[0][0].model).toBe('gpt-4o-mini');

        process.env.KNOWLEDGE_AUDIT_MODEL = 'gpt-5.4-mini';
        await reviewCluster(pair);
        expect(complete.mock.calls[1][0].model).toBe('gpt-5.4-mini');
    });

    // Measured: an eight-chunk group takes ~20s. Under getLLM()'s 10s
    // conversational default both attempts were cancelled by the clock and the
    // group vanished from the audit with only a generic "all providers failed".
    it('asks for a timeout well above the conversational default', async () => {
        answers({ verdict: 'fine' });
        await reviewCluster(pair);
        expect(complete.mock.calls[0][0].timeoutMs).toBeGreaterThanOrEqual(30_000);
    });

    it('sends the source and its date so the reviewer can pick the authoritative chunk', async () => {
        answers({ verdict: 'fine' });
        await reviewCluster([
            { ...pair[0], sourceUpdatedAt: new Date('2024-03-01') },
            { ...pair[1], sourceUpdatedAt: new Date('2026-08-01') }
        ]);

        const prompt = complete.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('eski.pdf');
        expect(prompt).toContain('2024-03-01');
        expect(prompt).toContain('2026-08-01');
    });
});

describe('reviewJunkBatch', () => {
    beforeEach(() => vi.clearAllMocks());

    it('maps flagged indices back to chunk ids', async () => {
        answers({
            junk: [
                { index: 0, quote: 'Ana Sayfa Ürünler', reason: 'navigation menu' },
                { index: 2, quote: '2026 SalesAI', reason: 'footer' }
            ]
        });

        expect(
            await reviewJunkBatch([
                { id: 'j0', text: 'Ana Sayfa | Ürünler' },
                { id: 'j1', text: 'Kurumsal pakette SSO vardır.' },
                { id: 'j2', text: '© 2026 SalesAI' }
            ])
        ).toEqual([
            { chunkId: 'j0', reason: 'navigation menu' },
            { chunkId: 'j2', reason: 'footer' }
        ]);
    });

    it('drops indices that do not point at a chunk', async () => {
        answers({
            junk: [
                { index: 9, quote: 'nav', reason: 'x' },
                { index: 'one', quote: 'nav', reason: 'y' },
                { index: 0, quote: 'nav' }
            ]
        });

        expect(await reviewJunkBatch([{ id: 'j0', text: 'nav' }])).toEqual([
            { chunkId: 'j0', reason: '' }
        ]);
    });

    it('flags nothing when the answer has no junk array', async () => {
        answers({ notJunk: [] });
        expect(await reviewJunkBatch([{ id: 'j0', text: 'nav' }])).toEqual([]);
    });

    it('survives a provider failure without throwing', async () => {
        complete.mockRejectedValue(new Error('rate limited'));
        expect(await reviewJunkBatch([{ id: 'j0', text: 'nav' }])).toEqual([]);
    });

    it('does not call the model for an empty batch', async () => {
        expect(await reviewJunkBatch([])).toEqual([]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('asks for the same generous timeout as the cluster reviewer', async () => {
        answers({ junk: [] });
        await reviewJunkBatch([{ id: 'j0', text: 'nav' }]);
        expect(complete.mock.calls[0][0].timeoutMs).toBeGreaterThanOrEqual(30_000);
    });
});

describe('reviewJunkBatch — read receipt', () => {
    beforeEach(() => vi.clearAllMocks());

    const chunks = [
        { id: 'j0', text: 'Skip to content Your cart is empty Continue shopping' },
        { id: 'j1', text: 'How to Order: select your gang sheet size and upload your file.' }
    ];

    it('accepts a flag whose quote really opens the chunk', async () => {
        answers({ junk: [{ index: 0, quote: 'Skip to content Your cart', reason: 'cart widget' }] });
        expect(await reviewJunkBatch(chunks)).toEqual([{ chunkId: 'j0', reason: 'cart widget' }]);
    });

    it('tolerates re-cased and re-punctuated quotes', async () => {
        answers({ junk: [{ index: 0, quote: 'skip to content, your cart', reason: 'nav' }] });
        expect(await reviewJunkBatch(chunks)).toHaveLength(1);
    });

    // Observed for real: 34 of 40 chunks flagged "navigation menus", including
    // ones stating prices and ordering steps. A model that cannot quote the
    // chunk is labelling the batch, not reading it.
    it('drops a flag with no quote at all', async () => {
        answers({ junk: [{ index: 1, reason: 'navigation menus' }] });
        expect(await reviewJunkBatch(chunks)).toEqual([]);
    });

    it('drops a flag whose quote is not in the chunk', async () => {
        answers({ junk: [{ index: 1, quote: 'Skip to content Your cart', reason: 'nav' }] });
        expect(await reviewJunkBatch(chunks)).toEqual([]);
    });
});
