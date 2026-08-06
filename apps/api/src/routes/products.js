import { Router } from 'express';
import { validate } from '@repo/validation';
import { ProductInput, ProductUpdateInput } from '@repo/contracts';
import { Product, Workspace, Membership, Agent, ShareLink, Session, KnowledgeSource } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { requirePermission } from '@repo/access';
import { resolveTenant, resolveMember } from '../middleware/tenant.js';
import { encryptField, decryptField } from '@repo/utils';
import { enqueue, QUEUES } from '@repo/queue';

export const productsRouter = Router();

/**
 * Bir ürünün websiteUrl'ini KnowledgeSource ile senkronize eder ve gerekirse
 * ingestion kuyruğuna alır. Üç senaryo:
 *
 * 1. websiteUrl set edildi, daha önce kaynak yok → oluştur + kuyruğa ekle
 * 2. websiteUrl değişti, kaynak var              → URL güncelle + re-ingest
 * 3. websiteUrl silindi (null/'')                → kaynağı 'disabled' yap
 *
 * @param {string|mongoose.ObjectId} productId
 * @param {string|null|undefined} websiteUrl  - Güncellenmiş URL (falsy = silindi)
 * @param {string|null|undefined} prevUrl     - Önceki URL (karşılaştırma için)
 */
async function syncWebsiteUrlSource(productId, websiteUrl, prevUrl) {
    // websiteUrl alanı bu çağrıda hiç gönderilmemiş → dokunma
    if (websiteUrl === undefined) return;

    const normalizedNew = websiteUrl || null;
    const normalizedPrev = prevUrl || null;

    // Değişim yoksa gereksiz DB işlemi yapma
    if (normalizedNew === normalizedPrev) return;

    // Bu product'a ait mevcut auto-url kaynağını bul (meta.autoCreated: true ile etiketliyoruz)
    const existing = await KnowledgeSource.findOne({
        productId,
        type: 'url',
        'meta.autoCreated': true
    });

    if (!normalizedNew) {
        // websiteUrl silindi → kaynağı devre dışı bırak (geçmiş chunk'ları koru)
        if (existing) {
            await KnowledgeSource.findByIdAndUpdate(existing._id, {
                $set: { status: 'disabled', 'meta.disabledAt': new Date() }
            });
        }
        return;
    }

    if (!existing) {
        // İlk kez set ediliyor → yeni KnowledgeSource oluştur
        const source = await KnowledgeSource.create({
            productId,
            type: 'url',
            url: normalizedNew,
            title: `Website: ${normalizedNew}`,
            status: 'pending',
            meta: { autoCreated: true }
        });
        await enqueue(QUEUES.INGESTION, 'ingest-source', {
            sourceId: String(source._id),
            productId: String(productId)
        });
    } else {
        // Kaynak var ama URL değişti → güncelle + re-ingest
        await KnowledgeSource.findByIdAndUpdate(existing._id, {
            $set: {
                url: normalizedNew,
                title: `Website: ${normalizedNew}`,
                status: 'pending',
                error: null
            }
        });
        await enqueue(QUEUES.INGESTION, 'ingest-source', {
            sourceId: String(existing._id),
            productId: String(productId)
        });
    }
}

/**
 * Force-reingests the product's auto-created url KnowledgeSource (if any)
 * without touching its URL — used when demoSession credentials change but
 * websiteUrl doesn't. Without this, content ingested before a demo account
 * was configured (or with stale credentials) stays anonymous/partial
 * forever, since nothing else re-triggers a crawl.
 *
 * @param {string|mongoose.ObjectId} productId
 */
async function reingestAutoUrlSource(productId) {
    const existing = await KnowledgeSource.findOne({
        productId,
        type: 'url',
        'meta.autoCreated': true
    });
    if (!existing) return;

    await KnowledgeSource.findByIdAndUpdate(existing._id, {
        $set: { status: 'pending', error: null }
    });
    await enqueue(QUEUES.INGESTION, 'ingest-source', {
        sourceId: String(existing._id),
        productId: String(productId)
    });
}

/**
 * POST /products
 *
 * Bir workspace'e yeni ürün ekler. Ürünler, knowledge (bilgi kaynakları) ve
 * agent'ların bağlandığı ana birimdir. Örneğin: "CRM Yazılımım" adlı bir ürün.
 *
 * Middleware zinciri:
 * 1. requireAuth → JWT token doğrulaması (kim olduğunu biliyoruz)
 * 2. resolveTenant → workspaceId'yi request'ten çözümle
 * 3. resolveMember → kullanıcının o workspace'teki rolünü bul
 * 4. requirePermission('product:create') → RBAC: rolü bu işleme izin veriyor mu?
 * 5. validate → Zod şeması ile body doğrulama
 *
 * Body: { "workspaceId": "...", "name": "Ürün Adı", "description": "...", "websiteUrl": "..." }
 */
productsRouter.post(
    '/',
    requireAuth,
    resolveTenant,
    resolveMember,
    requirePermission('product:create'),
    validate({ body: ProductInput }),
    async (req, res, next) => {
        try {
            const product = await Product.create({
                workspaceId: req.workspaceId,
                name: req.body.name,
                description: req.body.description,
                websiteUrl: req.body.websiteUrl,
                tourAllowedDomains: req.body.tourAllowedDomains
            });

            // websiteUrl verilmişse otomatik olarak bir KnowledgeSource oluştur ve kuyruğa ekle
            await syncWebsiteUrlSource(product._id, req.body.websiteUrl, null);

            res.status(201).json({
                id: String(product._id),
                workspaceId: String(product.workspaceId),
                name: product.name,
                description: product.description,
                websiteUrl: product.websiteUrl,
                tourAllowedDomains: product.tourAllowedDomains
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /products/:id
 *
 * Ürün detaylarını döner. Ürünün ait olduğu workspace'e üye olmalısın.
 */
productsRouter.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Ürünün workspace'ine üyelik kontrolü
        const membership = await Membership.findOne({
            workspaceId: product.workspaceId,
            userId: req.user.sub
        });

        if (!membership) {
            return res.status(403).json({ error: 'Not a member of this workspace' });
        }

        res.json({
            id: String(product._id),
            workspaceId: String(product.workspaceId),
            name: product.name,
            description: product.description,
            websiteUrl: product.websiteUrl,
            tourAllowedDomains: product.tourAllowedDomains,
            demoSession: product.demoSession ? JSON.parse(decryptField(product.demoSession)) : undefined,
            createdAt: product.createdAt
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /products?workspaceId=...
 *
 * Bir workspace'teki tüm ürünleri listeler.
 */
productsRouter.get('/', requireAuth, async (req, res, next) => {
    try {
        const { workspaceId } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ error: 'workspaceId query param is required' });
        }

        // Üyelik kontrolü
        const membership = await Membership.findOne({
            workspaceId,
            userId: req.user.sub
        });

        if (!membership) {
            return res.status(403).json({ error: 'Not a member of this workspace' });
        }

        const products = await Product.find({ workspaceId }).sort({ createdAt: -1 });

        res.json(
            products.map((p) => ({
                id: String(p._id),
                name: p.name,
                description: p.description,
                websiteUrl: p.websiteUrl,
                createdAt: p.createdAt
            }))
        );
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /products/:id
 *
 * Ürün adı, açıklaması veya websiteUrl'ini günceller.
 * Workspace üyeliği zorunludur.
 */
productsRouter.patch('/:id', requireAuth, validate({ body: ProductUpdateInput }), async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        // Workspace üyeliği kontrolü
        const membership = await Membership.findOne({
            workspaceId: product.workspaceId,
            userId: req.user.sub
        });
        if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

        const update = {};
        if (req.body.name !== undefined) update.name = req.body.name;
        if (req.body.description !== undefined) update.description = req.body.description;
        if (req.body.websiteUrl !== undefined) update.websiteUrl = req.body.websiteUrl;
        if (req.body.tourAllowedDomains !== undefined) update.tourAllowedDomains = req.body.tourAllowedDomains;
        if (req.body.demoSession !== undefined) {
            update.demoSession = req.body.demoSession === null ? null : encryptField(JSON.stringify(req.body.demoSession));
        }

        const updated = await Product.findByIdAndUpdate(
            req.params.id,
            { $set: update },
            { new: true, runValidators: true }
        );

        // websiteUrl değiştiyse KnowledgeSource'u senkronize et; değişmediyse ama
        // demoSession değiştiyse (websiteUrl aynı kaldı) mevcut auto-source'u
        // yeni kimlik bilgileriyle re-ingest et.
        if (req.body.websiteUrl !== undefined) {
            await syncWebsiteUrlSource(updated._id, req.body.websiteUrl, product.websiteUrl);
        } else if (req.body.demoSession !== undefined && updated.websiteUrl) {
            await reingestAutoUrlSource(updated._id);
        }

        res.json({
            id: String(updated._id),
            workspaceId: String(updated.workspaceId),
            name: updated.name,
            description: updated.description,
            websiteUrl: updated.websiteUrl,
            tourAllowedDomains: updated.tourAllowedDomains,
            demoSession: updated.demoSession ? JSON.parse(decryptField(updated.demoSession)) : undefined,
            updatedAt: updated.updatedAt
        });
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /products/:id
 *
 * Ürünü ve bağlı tüm agent'ları + shareLink'leri cascade siler.
 * Herhangi bir agent'ta live session varsa 409 döner.
 */
productsRouter.delete('/:id', requireAuth, async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        // Workspace üyeliği kontrolü
        const membership = await Membership.findOne({
            workspaceId: product.workspaceId,
            userId: req.user.sub
        });
        if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

        // Bu ürüne bağlı agent'ları bul
        const agents = await Agent.find({ productId: product._id }, '_id');
        const agentIds = agents.map(a => a._id);

        // Live session guard
        if (agentIds.length > 0) {
            const liveSession = await Session.findOne({ agentId: { $in: agentIds }, status: 'live' });
            if (liveSession) {
                return res.status(409).json({ error: 'Product has an agent with an active live session. End it before deleting.' });
            }
            await ShareLink.deleteMany({ agentId: { $in: agentIds } });
            await Agent.deleteMany({ productId: product._id });
        }

        await Product.deleteOne({ _id: product._id });

        res.json({ ok: true, productId: String(product._id), deletedAgents: agentIds.length });
    } catch (err) {
        next(err);
    }
});
