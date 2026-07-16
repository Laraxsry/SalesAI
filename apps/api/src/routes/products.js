import { Router } from 'express';
import { validate } from '@repo/validation';
import { ProductInput } from '@repo/contracts';
import { Product, Workspace, Membership } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { requirePermission } from '@repo/access';
import { resolveTenant, resolveMember } from '../middleware/tenant.js';

export const productsRouter = Router();

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
