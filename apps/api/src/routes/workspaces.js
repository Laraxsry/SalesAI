import { Router } from 'express';
import { Workspace, Membership } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { shortId } from '@repo/utils';

export const workspacesRouter = Router();

/**
 * POST /workspaces
 *
 * Yeni bir workspace oluşturur. Her workspace bir "takım alanı"dır.
 * Ürünler, agent'lar vb. hep bir workspace'e aittir.
 * Oluşturan kişi otomatik OWNER olur.
 *
 * Body: { "name": "Şirketim" }
 */
workspacesRouter.post('/', requireAuth, async (req, res, next) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(422).json({ error: 'name is required' });
        }

        // Workspace oluştur — slug otomatik üretilir
        const workspace = await Workspace.create({
            name: name.trim(),
            slug: `ws-${shortId(8)}`,
            ownerId: req.user.sub
        });

        // Oluşturan kişiyi OWNER yap
        await Membership.create({
            workspaceId: workspace._id,
            userId: req.user.sub,
            role: 'OWNER'
        });

        res.status(201).json({
            id: String(workspace._id),
            name: workspace.name,
            slug: workspace.slug
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /workspaces/:id
 *
 * Workspace detaylarını döner. Sadece üyeler görebilir.
 * Üyelik kontrolü: kullanıcının o workspace'te Membership kaydı var mı?
 */
workspacesRouter.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const workspace = await Workspace.findById(req.params.id);
        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        // Kullanıcının bu workspace'e üye olup olmadığını kontrol et
        const membership = await Membership.findOne({
            workspaceId: workspace._id,
            userId: req.user.sub
        });

        if (!membership) {
            return res.status(403).json({ error: 'Not a member of this workspace' });
        }

        res.json({
            id: String(workspace._id),
            name: workspace.name,
            slug: workspace.slug,
            role: membership.role,
            createdAt: workspace.createdAt
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /workspaces
 *
 * Kullanıcının üye olduğu tüm workspace'leri listeler.
 */
workspacesRouter.get('/', requireAuth, async (req, res, next) => {
    try {
        // Kullanıcının tüm üyeliklerini bul
        const memberships = await Membership.find({ userId: req.user.sub });
        const workspaceIds = memberships.map((m) => m.workspaceId);

        // O workspace'leri getir
        const workspaces = await Workspace.find({ _id: { $in: workspaceIds } });

        // Üyelik bilgisi ile birleştir
        const result = workspaces.map((ws) => {
            const mem = memberships.find((m) => String(m.workspaceId) === String(ws._id));
            return {
                id: String(ws._id),
                name: ws.name,
                slug: ws.slug,
                role: mem?.role,
                createdAt: ws.createdAt
            };
        });

        res.json(result);
    } catch (err) {
        next(err);
    }
});
