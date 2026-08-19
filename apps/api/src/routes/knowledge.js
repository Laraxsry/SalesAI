import { Router } from 'express';
import { validate } from '@repo/validation';
import { KnowledgeSourceInput, KnowledgeSourceUpdateInput } from '@repo/contracts';
import { KnowledgeSource, KnowledgeChunk, KnowledgeGapReport, Product, Membership } from '@repo/database';
import { enqueueIngestion } from '../lib/ingestion.js';
import { requireAuth } from '@repo/auth';
import { can } from '@repo/access';
import { enqueue, QUEUES } from '@repo/queue';
import { presignUpload, presignDownload } from '@repo/storage';
import { shortId } from '@repo/utils';

// Kaynak (source) değil, ÜRÜN (product) bazlı — istekte bulunan kullanıcının
// bu ürünün workspace'ine üye olup olmadığını (ve rolünü) çözer. GAP analizi
// gerçek para maliyeti olan (LLM) ve kota'ya tabi bir işlem tetiklediği için
// bu dosyanın diğer birçok endpoint'inde olmayan (bkz. `GET /:productId`)
// bir üyelik+rol kontrolü burada bilinçli olarak var.
async function loadOwnedProduct(productId, userId) {
    const product = await Product.findById(productId).select('workspaceId');
    if (!product) return { product: null, membership: null };
    const membership = await Membership.findOne({ workspaceId: product.workspaceId, userId });
    return { product, membership };
}

// TODO(gap-analysis quota): geliştirme aşamasında kullanıcı isteğiyle
// KALDIRILDI (2026-08-19) — bir önceki halinde başarısız (status:'failed')
// bir rapor bile kotadan düşüyordu (sayım sadece createdAt'e bakıyordu,
// status'a bakmıyordu), bu da bir LLM hatasından sonra kullanıcının o gün
// bir daha hiç deneyemediği bir durağa sokuyordu. Ürün olgunlaştığında
// kota GERİ EKLENECEK — o zaman sadece status:'ready' (gerçekten
// tamamlanmış) raporları saymalı, `failed` denemeler kullanıcının hakkını
// yemesin.
const GAP_ANALYSIS_DAILY_LIMIT = Infinity;

export const knowledgeRouter = Router();

/**
 * Resolves a KnowledgeSource and checks the caller is a member of the
 * workspace that owns it (same check as `GET /products/:id`) — unlike the
 * existing list/delete routes below, this file now also exposes a raw file
 * download URL and lets a workspace member overwrite a source's content, so
 * new endpoints get the membership check the older ones were missing.
 */
async function loadOwnedSource(id, userId) {
    const source = await KnowledgeSource.findById(id);
    if (!source) return { source: null, membership: null };
    const product = await Product.findById(source.productId).select('workspaceId');
    const membership = product
        ? await Membership.findOne({ workspaceId: product.workspaceId, userId })
        : null;
    return { source, membership };
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
            await enqueueIngestion(source._id, req.body.productId, { type: req.body.type });
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
 * POST /knowledge/:productId/gap-analysis
 *
 * Proaktif knowledge GAP analizini tetikler — ürünün TÜM 'ready' knowledge
 * kaynaklarını (bkz. `analyzeKnowledgeGaps()`,
 * `apps/worker-general/src/handlers/analyze-knowledge-gaps.js`) tek bir LLM
 * çağrısıyla karşılaştırıp tutarsızlık/yetersiz-detay/eksik-konu bulguları
 * üretir. `GET /analytics/knowledge-gaps` (ziyaretçinin cevaplanamayan
 * sorularının aggregation'ı, reaktif) ile KARIŞTIRILMAMALI — bu tamamen
 * ayrı, proaktif bir özellik.
 *
 * Kota: şu an DEVRE DIŞI (`GAP_ANALYSIS_DAILY_LIMIT`, bkz. yukarısı) —
 * geliştirme aşamasında kullanıcı isteğiyle kaldırıldı, ileride geri
 * eklenecek. Alt yapı (son 24 saatteki `KnowledgeGapReport` sayısına
 * bakma) hâlâ burada, sadece limit `Infinity`.
 */
knowledgeRouter.post('/:productId/gap-analysis', requireAuth, async (req, res, next) => {
    try {
        const { product, membership } = await loadOwnedProduct(req.params.productId, req.user.sub);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });
        if (!can(membership.role, 'knowledge:analyze')) {
            return res.status(403).json({ error: 'Forbidden', required: 'knowledge:analyze' });
        }

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentCount = await KnowledgeGapReport.countDocuments({
            productId: product._id,
            createdAt: { $gte: since }
        });
        if (recentCount >= GAP_ANALYSIS_DAILY_LIMIT) {
            return res.status(429).json({
                error: `Günlük analiz hakkınız doldu (limit: ${GAP_ANALYSIS_DAILY_LIMIT}/gün)`,
                retryAfter: since.toISOString()
            });
        }

        const report = await KnowledgeGapReport.create({
            productId: product._id,
            requestedBy: req.user.sub,
            status: 'processing'
        });
        await enqueue(QUEUES.GENERAL, 'analyze-knowledge-gaps', {
            reportId: String(report._id),
            productId: String(product._id)
        });

        res.status(201).json({ id: String(report._id), status: report.status });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /knowledge/:productId/gap-analysis
 *
 * Son GAP raporlarını (en yeni önce) + `canRequestNow` (günlük kota dolu
 * mu) döndürür — Console'daki "Analiz Et" butonunun disabled durumu
 * buradan okunuyor.
 */
knowledgeRouter.get('/:productId/gap-analysis', requireAuth, async (req, res, next) => {
    try {
        const { product, membership } = await loadOwnedProduct(req.params.productId, req.user.sub);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [reports, recentCount] = await Promise.all([
            KnowledgeGapReport.find({ productId: product._id }).sort({ createdAt: -1 }).limit(10),
            KnowledgeGapReport.countDocuments({ productId: product._id, createdAt: { $gte: since } })
        ]);

        res.json({
            reports,
            canRequestNow: recentCount < GAP_ANALYSIS_DAILY_LIMIT && can(membership.role, 'knowledge:analyze')
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /knowledge/:id/download-url
 *
 * Short-lived presigned GET for the source's underlying file (document/image/
 * video), used by the Console detail modal to render/preview it. Zip-child
 * sources have no fileKey (see ingestZipEntries) — 404s.
 */
knowledgeRouter.get('/:id/download-url', requireAuth, async (req, res, next) => {
    try {
        const { source, membership } = await loadOwnedSource(req.params.id, req.user.sub);
        if (!source) return res.status(404).json({ error: 'Knowledge source not found' });
        if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });
        if (!source.fileKey) return res.status(404).json({ error: 'This source has no file' });

        const url = await presignDownload(source.fileKey);
        res.json({ url });
    } catch (err) {
        next(err);
    }
});

/**
 * Re-downloads and re-extracts the original file (`@repo/rag`'s
 * `extractDocumentText()`, the same paragraph-preserving function ingestion
 * itself uses) for `document` sources that still have their file — including
 * zip children, whose own file lives inside their *parent's* fileKey
 * (`extractZipMemberText()` re-opens the archive and pulls just that
 * member). Returns `null` when that isn't possible/fails so the caller can
 * fall back.
 */
async function reExtractDocumentText(source) {
    if (source.type !== 'document') return null;

    if (source.parentSourceId && source.meta?.zipEntry) {
        try {
            const parent = await KnowledgeSource.findById(source.parentSourceId).select('fileKey');
            if (!parent?.fileKey) return null;
            const { extractZipMemberText } = await import('@repo/rag');
            const url = await presignDownload(parent.fileKey);
            const response = await fetch(url);
            if (!response.ok) return null;
            const zipBuffer = Buffer.from(await response.arrayBuffer());
            return await extractZipMemberText(zipBuffer, source.meta.zipEntry);
        } catch (err) {
            console.warn('[knowledge] zip member re-extraction failed, falling back:', err.message);
            return null;
        }
    }

    if (!source.fileKey) return null;
    const ext = (source.fileKey || '').split('.').pop()?.toLowerCase();
    const isZip = ext === 'zip' || (source.mimeType || '').includes('zip');
    if (isZip) return null;

    try {
        const { extractDocumentText } = await import('@repo/rag');
        const url = await presignDownload(source.fileKey);
        const response = await fetch(url);
        if (!response.ok) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        return await extractDocumentText(buffer, { mime: source.mimeType || '', ext });
    } catch (err) {
        console.warn('[knowledge] content re-extraction failed, falling back:', err.message);
        return null;
    }
}

/**
 * Joins the source's already-embedded chunks — lossy (`chunkText()`
 * collapses all whitespace, including paragraph breaks, before embedding —
 * see `packages/rag/src/chunk.js`) but the last-resort fallback when
 * re-extraction isn't possible (non-document types: image/video/url/api) or
 * fails.
 */
async function joinChunkText(source) {
    const chunks = await KnowledgeChunk.find({ sourceId: source._id }).sort({ _id: 1 }).select('text');
    return chunks.map((c) => c.text).join('\n\n');
}

/**
 * GET /knowledge/:id/content
 *
 * Returns the text the AI actually knows for this source. Trusts
 * `meta.extractedText` whenever it's already set — that's the ONLY place a
 * hand edit from `PATCH /:id` is stored (the underlying file is never
 * touched by an edit), so unconditionally re-deriving from the file here
 * would silently discard every edit the next time this endpoint is called,
 * which is exactly what re-deriving unconditionally used to do. Only
 * missing `meta.extractedText` (a source that predates this field, or one
 * whose file was just replaced — `PATCH /:id`'s fileKey branch explicitly
 * `$unset`s it) triggers re-derivation: prefer re-extracting fresh from the
 * file (`reExtractDocumentText()` — paragraph-preserving, same as
 * ingestion) over the lossy chunk-join fallback.
 */
knowledgeRouter.get('/:id/content', requireAuth, async (req, res, next) => {
    try {
        const { source, membership } = await loadOwnedSource(req.params.id, req.user.sub);
        if (!source) return res.status(404).json({ error: 'Knowledge source not found' });
        if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

        let extractedText = source.meta?.extractedText;
        if (!extractedText) extractedText = await reExtractDocumentText(source);
        if (!extractedText) extractedText = await joinChunkText(source);

        if (extractedText && extractedText !== source.meta?.extractedText) {
            await KnowledgeSource.findByIdAndUpdate(source._id, { 'meta.extractedText': extractedText }).catch(() => {});
        }
        res.json({ extractedText: extractedText || '' });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /knowledge/:id/chunks
 *
 * Lists the source's already-embedded chunks (id, text, audience,
 * metadata) — used by the Console detail modal for url/api sources to group
 * retrieved chunks under the crawled page they came from
 * (`metadata.pageUrl`, set per-segment by `handleIngestSource()`/
 * `extractFromUrl()`) instead of showing one undifferentiated crawl blob,
 * and to let a seller see exactly what the agent will retrieve (and how
 * it was classified: general vs. technical). `synthesized`/`scope` flag the
 * interpretive per-page and cross-page overview chunks added alongside the
 * raw ones (see `synthesizePage()`/`synthesizeOverview()` in `@repo/ai`).
 */
knowledgeRouter.get('/:id/chunks', requireAuth, async (req, res, next) => {
    try {
        const { source, membership } = await loadOwnedSource(req.params.id, req.user.sub);
        if (!source) return res.status(404).json({ error: 'Knowledge source not found' });
        if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

        const chunks = await KnowledgeChunk.find({ sourceId: source._id })
            .sort({ _id: 1 })
            .select('text audience metadata');
        res.json(
            chunks.map((c) => ({
                id: String(c._id),
                text: c.text,
                audience: c.audience,
                pageUrl: c.metadata?.pageUrl,
                synthesized: !!c.metadata?.synthesized,
                scope: c.metadata?.scope
            }))
        );
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /knowledge/:id
 *
 * Three mutually exclusive shapes, resolved in this order:
 *  - `fileKey` present  -> replace the underlying file, re-run the full
 *    ingest pipeline (OCR/Whisper/Vision) from scratch, same as creation.
 *  - `content`/`extractedText` present -> save the already-extracted text
 *    directly (no re-download/re-extraction) and re-chunk+embed only the
 *    chunks that actually changed vs. the previous text
 *    (`reingestSourceIncremental()`, `packages/rag/src/ingest.js`).
 *  - otherwise -> title-only rename, no re-ingestion.
 */
knowledgeRouter.patch(
    '/:id',
    requireAuth,
    validate({ body: KnowledgeSourceUpdateInput }),
    async (req, res, next) => {
        try {
            const { source, membership } = await loadOwnedSource(req.params.id, req.user.sub);
            if (!source) return res.status(404).json({ error: 'Knowledge source not found' });
            if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

            const { title, content, extractedText, fileKey, mimeType } = req.body;

            if (fileKey) {
                await KnowledgeSource.findByIdAndUpdate(source._id, {
                    fileKey,
                    mimeType,
                    status: 'pending',
                    ...(title !== undefined && { title }),
                    $unset: {
                        error: '',
                        'meta.extractedText': '',
                        'meta.transcript': '',
                        'meta.frameCount': '',
                        'meta.frameCaptionCount': ''
                    }
                });
                await enqueueIngestion(source._id, source.productId, { type: source.type });
                return res.json({ ok: true, status: 'pending' });
            }

            const editedText = content ?? extractedText;
            if (editedText !== undefined) {
                // Captured before overwriting — reingestSourceIncremental() needs the
                // pre-edit text to diff against so it only re-embeds what changed.
                const oldText = content !== undefined ? source.content || '' : source.meta?.extractedText || '';

                if (title !== undefined) source.title = title;
                if (content !== undefined) source.content = content;
                if (extractedText !== undefined) {
                    source.meta = { ...(source.meta || {}), extractedText };
                    source.markModified('meta');
                }
                await source.save();

                const modality = { image: 'image', video: 'video', url: 'web', api: 'web' }[source.type] || 'text';
                const { reingestSourceIncremental } = await import('@repo/rag');
                try {
                    await reingestSourceIncremental({
                        sourceId: String(source._id),
                        productId: String(source.productId),
                        oldText,
                        newText: editedText,
                        modality
                    });
                } catch (embedErr) {
                    await KnowledgeSource.findByIdAndUpdate(source._id, { status: 'failed', error: embedErr.message }).catch(() => {});
                    throw embedErr;
                }
                return res.json({ ok: true, status: 'ready' });
            }

            if (title !== undefined) {
                source.title = title;
                await source.save();
            }
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    }
);

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
