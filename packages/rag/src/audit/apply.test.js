import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {
    listByProduct: vi.fn(),
    upsert: vi.fn(),
    setStatus: vi.fn(),
    query: vi.fn()
};
const embed = vi.fn();
const invalidateProductCache = vi.fn();
let audits = new Map();

vi.mock('@repo/ai', () => ({ embed: (...a) => embed(...a), getLLM: () => ({ complete: vi.fn() }) }));
vi.mock('@repo/logger', () => ({ Logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../stores/index.js', () => ({ getVectorStore: () => store }));
vi.mock('../retrieve.js', () => ({ invalidateProductCache: (...a) => invalidateProductCache(...a) }));
vi.mock('@repo/database', () => ({
    KnowledgeAudit: { findById: async (id) => audits.get(id) ?? null, findByIdAndUpdate: vi.fn() },
    KnowledgeSource: { findOneAndUpdate: async () => ({ _id: 'curated-source' }) }
}));

const { applyAuditFindings } = await import('./index.js');

/** An audit document with the mutability `.save()` relies on. */
function makeAudit(findings) {
    const audit = {
        _id: 'audit-1',
        productId: 'prod-1',
        status: 'ready',
        findings,
        save: vi.fn(async () => {})
    };
    audits.set('audit-1', audit);
    return audit;
}

const contradiction = {
    key: 'contradiction:abc',
    type: 'contradiction',
    summary: 'Farklı fiyat',
    chunkIds: ['c1', 'c2'],
    keepChunkId: 'c2',
    canonicalText: 'Başlangıç paketi aylık 750 TL.',
    audience: 'general',
    decision: 'pending'
};

const duplicateKeepOnly = {
    key: 'duplicate:def',
    type: 'duplicate',
    summary: 'Aynı bilgi',
    chunkIds: ['d1', 'd2', 'd3'],
    keepChunkId: 'd2',
    canonicalText: undefined,
    decision: 'pending'
};

const junk = {
    key: 'junk:ghi',
    type: 'junk',
    summary: 'navigation menu',
    chunkIds: ['j1'],
    decision: 'pending'
};

beforeEach(() => {
    vi.clearAllMocks();
    audits = new Map();
    embed.mockResolvedValue([0.1, 0.2, 0.3]);
    store.upsert.mockResolvedValue(['curated-chunk-1']);
    store.setStatus.mockResolvedValue(1);
    invalidateProductCache.mockResolvedValue(3);
});

describe('applyAuditFindings', () => {
    it('writes a curated chunk and points the originals at it', async () => {
        const audit = makeAudit([{ ...contradiction }]);

        const result = await applyAuditFindings({ auditId: 'audit-1', approvedKeys: [contradiction.key] });

        expect(store.upsert).toHaveBeenCalledWith([
            expect.objectContaining({
                productId: 'prod-1',
                sourceId: 'curated-source',
                text: 'Başlangıç paketi aylık 750 TL.',
                status: 'active',
                curatedFrom: ['c1', 'c2']
            })
        ]);
        expect(store.setStatus).toHaveBeenCalledWith({
            ids: ['c1', 'c2'],
            status: 'superseded',
            supersededBy: 'curated-chunk-1'
        });
        expect(result).toMatchObject({ applied: 1, curatedChunks: 1, failed: 0 });
        expect(audit.findings[0].decision).toBe('applied');
    });

    // Paraphrasing knowledge that is already correct only risks changing it.
    it('keeps the authoritative chunk untouched when no rewrite was proposed', async () => {
        makeAudit([{ ...duplicateKeepOnly }]);

        await applyAuditFindings({ auditId: 'audit-1', approvedKeys: [duplicateKeepOnly.key] });

        expect(store.upsert).not.toHaveBeenCalled();
        expect(embed).not.toHaveBeenCalled();
        expect(store.setStatus).toHaveBeenCalledWith({
            ids: ['d1', 'd3'], // d2 stays active
            status: 'superseded',
            supersededBy: 'd2'
        });
    });

    it('excludes junk without writing anything in its place', async () => {
        makeAudit([{ ...junk }]);

        await applyAuditFindings({ auditId: 'audit-1', approvedKeys: [junk.key] });

        expect(store.setStatus).toHaveBeenCalledWith({ ids: ['j1'], status: 'excluded' });
        expect(store.upsert).not.toHaveBeenCalled();
    });

    it('leaves findings nobody approved completely alone', async () => {
        const audit = makeAudit([{ ...contradiction }, { ...junk }]);

        const result = await applyAuditFindings({ auditId: 'audit-1', approvedKeys: [] });

        expect(store.setStatus).not.toHaveBeenCalled();
        expect(result.applied).toBe(0);
        expect(audit.findings.every((f) => f.decision === 'pending')).toBe(true);
    });

    it('records a rejection without touching the store', async () => {
        const audit = makeAudit([{ ...contradiction }]);

        await applyAuditFindings({ auditId: 'audit-1', rejectedKeys: [contradiction.key] });

        expect(store.setStatus).not.toHaveBeenCalled();
        expect(audit.findings[0].decision).toBe('rejected');
    });

    // Re-applying would supersede the curated chunk written the first time,
    // leaving the product with the knowledge removed and nothing active.
    it('never applies a finding twice', async () => {
        makeAudit([{ ...contradiction, decision: 'applied' }]);

        const result = await applyAuditFindings({ auditId: 'audit-1', approvedKeys: [contradiction.key] });

        expect(store.setStatus).not.toHaveBeenCalled();
        expect(result.applied).toBe(0);
    });

    it('isolates a failing finding instead of aborting the rest', async () => {
        const audit = makeAudit([{ ...contradiction }, { ...junk }]);
        embed.mockRejectedValueOnce(new Error('embedding provider down'));

        const result = await applyAuditFindings({
            auditId: 'audit-1',
            approvedKeys: [contradiction.key, junk.key]
        });

        expect(result).toMatchObject({ applied: 1, failed: 1 });
        expect(audit.findings[0].decision).toBe('failed');
        expect(audit.findings[0].error).toMatch(/embedding provider down/);
        expect(audit.findings[1].decision).toBe('applied');
    });

    it('drops the retrieval cache so the agent stops quoting retired knowledge', async () => {
        makeAudit([{ ...junk }]);

        const result = await applyAuditFindings({ auditId: 'audit-1', approvedKeys: [junk.key] });

        expect(invalidateProductCache).toHaveBeenCalledWith('prod-1');
        expect(result.cacheEntriesDropped).toBe(3);
    });

    it('does not touch the cache when nothing was applied', async () => {
        makeAudit([{ ...contradiction }]);

        await applyAuditFindings({ auditId: 'audit-1', rejectedKeys: [contradiction.key] });

        expect(invalidateProductCache).not.toHaveBeenCalled();
    });

    it('closes the audit only once no finding is still pending', async () => {
        const audit = makeAudit([{ ...contradiction }, { ...junk }]);

        await applyAuditFindings({ auditId: 'audit-1', approvedKeys: [contradiction.key] });
        expect(audit.status).toBe('ready'); // junk still undecided

        await applyAuditFindings({ auditId: 'audit-1', rejectedKeys: [junk.key] });
        expect(audit.status).toBe('applied');
    });

    it('throws for an audit that does not exist rather than silently doing nothing', async () => {
        await expect(applyAuditFindings({ auditId: 'nope', approvedKeys: [] })).rejects.toThrow(
            /not found/i
        );
    });
});
