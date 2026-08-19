import { Router } from 'express';
import { validate } from '@repo/validation';
import { KnowledgeSourceInput } from '@repo/contracts';
import { KnowledgeAudit, KnowledgeChunk, KnowledgeSource, Membership, Product } from '@repo/database';
import { enqueue, QUEUES } from '@repo/queue';
import { requireAuth } from '@repo/auth';
import { presignUpload } from '@repo/storage';
import { shortId } from '@repo/utils';

export const knowledgeRouter = Router();

/**
 * Resolves a product and confirms the caller belongs to its workspace,
 * answering the request directly when it doesn't check out.
 *
 * The knowledge-audit endpoints below retire and rewrite a product's
 * knowledge, so — unlike the older read-oriented routes in this file — they
 * are gated on membership the same way `products.js` gates product access.
 *
 * @returns {Promise<object|null>} the product, or null once a response was sent
 */
async function resolveOwnedProduct(req, res, productId) {
    const product = await Product.findById(productId);
    if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return null;
    }
    const membership = await Membership.findOne({
        workspaceId: product.workspaceId,
        userId: req.user.sub
    });
    if (!membership) {
        res.status(403).json({ error: 'Not a member of this workspace' });
        return null;
    }
    return product;
}

/**
 * POST /knowledge/upload-url
 *
 * İstemcinin MinIO/S3'ye doğrudan dosya yükleyebilmesi için
 * geçici bir yükleme linki (presigned URL) oluşturur.
 *
 * Body: { "filename": "rapor.pdf", "contentType": "application/pdf" }
 */
knowledgeRouter.post('/upload-url', requireAuth, async (req, res, next) => {
    try {
        const { filename, contentType } = req.body;
        if (!filename || !contentType) {
            return res.status(400).json({ error: 'filename and contentType are required' });
        }

        // Benzersiz bir dosya anahtarı oluştur (örneğin: uploads/user123/rapor-abc123.pdf)
        const ext = filename.split('.').pop();
        const fileKey = `uploads/${req.user.sub}/${shortId(8)}.${ext}`;

        // 15 dakikalık yükleme linki oluştur
        const url = await presignUpload(fileKey, contentType, 900);

        res.json({ url, fileKey });
    } catch (err) {
        next(err);
    }
});

/**
 * Seller adds a knowledge source (text/document/image/video/url/api).
 * We persist it and enqueue an ingestion job; the worker extracts text,
 * embeds it, and marks the source ready.
 */
knowledgeRouter.post(
    '/',
    requireAuth,
    validate({ body: KnowledgeSourceInput }),
    async (req, res, next) => {
        try {
            const source = await KnowledgeSource.create({ ...req.body, status: 'pending' });
            await enqueue(QUEUES.INGESTION, 'ingest-source', {
                sourceId: String(source._id),
                productId: req.body.productId,
                type: req.body.type
            });
            res.status(201).json({ id: String(source._id), status: source.status });
        } catch (err) {
            next(err);
        }
    }
);

knowledgeRouter.get('/:productId', requireAuth, async (req, res, next) => {
    try {
        // 'disabled' status'lu source'lar (websiteUrl silinen ürünlerin otomatik kaynakları)
        // listede görünmemeli; DB'de geçmiş chunk referansı için tutuluyorlar.
        const sources = await KnowledgeSource.find({
            productId: req.params.productId,
            status: { $ne: 'disabled' }
        }).sort({ createdAt: -1 });
        res.json(sources);
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/v1/knowledge/:id
 * 
 * Deletes a knowledge source and its associated chunks from the vector store.
 */
knowledgeRouter.delete('/:id', requireAuth, async (req, res, next) => {
    try {
        const source = await KnowledgeSource.findById(req.params.id);
        if (!source) return res.status(404).json({ error: 'Knowledge source not found' });

        // 1. Delete source from DB
        await KnowledgeSource.deleteOne({ _id: source._id });

        // 2. Delete chunks from vector store (strategy handles both Mongo and Qdrant)
        try {
            const { getVectorStore } = await import('@repo/rag');
            await getVectorStore().deleteBySource(String(source._id));
        } catch (vectorErr) {
            console.warn('[knowledge] failed to delete chunks from vector store:', vectorErr.message);
        }

        res.json({ ok: true, message: 'Knowledge source and its chunks deleted successfully' });
    } catch (err) {
        next(err);
    }
});

/* ── Knowledge audit ──────────────────────────────────────────────────────
 * Reviews a product's knowledge for redundancy, contradictions and junk.
 * The run only ever writes *proposals*; nothing reaches the vector store
 * until an operator approves specific findings via the apply endpoint.
 */

/**
 * POST /knowledge/:productId/audit
 *
 * Queues an audit run. Returns immediately with the audit document — the scan
 * itself walks every chunk and makes a batch of LLM calls, far too slow for a
 * request/response cycle.
 */
knowledgeRouter.post('/:productId/audit', requireAuth, async (req, res, next) => {
    try {
        const product = await resolveOwnedProduct(req, res, req.params.productId);
        if (!product) return;

        // One run at a time per product: a second concurrent scan would spend
        // the same LLM budget to produce the same findings, and applying two
        // overlapping proposal sets could supersede the same chunks twice.
        const inFlight = await KnowledgeAudit.findOne({
            productId: product._id,
            status: { $in: ['queued', 'running'] }
        });
        if (inFlight) {
            return res.status(409).json({
                error: 'An audit is already running for this product',
                auditId: String(inFlight._id)
            });
        }

        const audit = await KnowledgeAudit.create({ productId: product._id, status: 'queued' });
        await enqueue(QUEUES.GENERAL, 'audit-knowledge', {
            productId: String(product._id),
            auditId: String(audit._id)
        });

        res.status(202).json({ id: String(audit._id), status: audit.status });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /knowledge/:productId/audits
 *
 * Recent runs for a product, newest first. Findings are omitted — the list is
 * for picking a run, and a full findings array is large.
 */
knowledgeRouter.get('/:productId/audits', requireAuth, async (req, res, next) => {
    try {
        const product = await resolveOwnedProduct(req, res, req.params.productId);
        if (!product) return;

        const audits = await KnowledgeAudit.find({ productId: product._id })
            .select('-findings')
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();

        res.json(audits.map((a) => ({ ...a, id: String(a._id) })));
    } catch (err) {
        next(err);
    }
});

/**
 * GET /knowledge/audit/:auditId
 *
 * One run with its findings, each carrying the text of every chunk involved
 * so the console can show the evidence next to the proposal — approving a
 * change without seeing what it removes is exactly what this flow exists to
 * prevent.
 */
knowledgeRouter.get('/audit/:auditId', requireAuth, async (req, res, next) => {
    try {
        const audit = await KnowledgeAudit.findById(req.params.auditId).lean();
        if (!audit) return res.status(404).json({ error: 'Audit not found' });
        if (!(await resolveOwnedProduct(req, res, audit.productId))) return;

        const chunkIds = [...new Set(audit.findings.flatMap((f) => f.chunkIds.map(String)))];
        const chunks = await KnowledgeChunk.find({ _id: { $in: chunkIds } })
            .select('text sourceId status')
            .lean();
        const sources = await KnowledgeSource.find({ productId: audit.productId })
            .select('title type')
            .lean();
        const sourceById = new Map(sources.map((s) => [String(s._id), s]));
        const chunkById = new Map(
            chunks.map((c) => [
                String(c._id),
                {
                    id: String(c._id),
                    text: c.text,
                    status: c.status || 'active',
                    sourceTitle: sourceById.get(String(c.sourceId))?.title || sourceById.get(String(c.sourceId))?.type
                }
            ])
        );

        res.json({
            ...audit,
            id: String(audit._id),
            findings: audit.findings.map((f) => ({
                ...f,
                chunks: f.chunkIds.map((id) => chunkById.get(String(id))).filter(Boolean)
            }))
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /knowledge/audit/:auditId/apply
 *
 * Applies the operator's decisions. Body: { approvedKeys: [], rejectedKeys: [] }
 */
knowledgeRouter.post('/audit/:auditId/apply', requireAuth, async (req, res, next) => {
    try {
        const audit = await KnowledgeAudit.findById(req.params.auditId).select('productId status').lean();
        if (!audit) return res.status(404).json({ error: 'Audit not found' });
        if (!(await resolveOwnedProduct(req, res, audit.productId))) return;
        if (audit.status === 'queued' || audit.status === 'running') {
            return res.status(409).json({ error: 'Audit is still running' });
        }

        const { approvedKeys = [], rejectedKeys = [] } = req.body || {};
        if (!Array.isArray(approvedKeys) || !Array.isArray(rejectedKeys)) {
            return res.status(400).json({ error: 'approvedKeys and rejectedKeys must be arrays' });
        }

        const { applyAuditFindings } = await import('@repo/rag');
        const result = await applyAuditFindings({
            auditId: req.params.auditId,
            approvedKeys,
            rejectedKeys
        });

        res.json(result);
    } catch (err) {
        next(err);
    }
});
