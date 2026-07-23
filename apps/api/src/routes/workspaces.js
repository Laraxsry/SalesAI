import crypto from 'node:crypto';
import { Router } from 'express';
import { Workspace, Membership, Invitation, User } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { requirePermission } from '@repo/access';
import { resolveTenant, resolveMember } from '../middleware/tenant.js';
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

/**
 * POST /workspaces/:id/invitations
 *
 * Workspace'e yeni bir üye davet eder. İmzalı bir davet token'ı üretir.
 * Body: { "email": "user@example.com", "role": "EDITOR" }
 */
workspacesRouter.post(
    '/:id/invitations',
    requireAuth,
    (req, _res, next) => { req.body = req.body || {}; req.body.workspaceId = req.params.id; next(); },
    resolveTenant,
    resolveMember,
    requirePermission('member:manage'),
    async (req, res, next) => {
        try {
            const { email, role = 'EDITOR' } = req.body;
            if (!email || !email.trim()) {
                return res.status(422).json({ error: 'email is required' });
            }

            const validRoles = ['ADMIN', 'EDITOR', 'VIEWER'];
            if (!validRoles.includes(role)) {
                return res.status(422).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
            }

            const cleanEmail = email.trim().toLowerCase();

            // Zaten davet edilmiş mi?
            const existingInv = await Invitation.findOne({
                workspaceId: req.workspaceId,
                email: cleanEmail,
                status: 'pending'
            });

            if (existingInv) {
                return res.status(409).json({ error: 'An active invitation for this email already exists' });
            }

            const token = crypto.randomBytes(24).toString('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 gün

            const invitation = await Invitation.create({
                workspaceId: req.workspaceId,
                email: cleanEmail,
                role,
                token,
                invitedBy: req.user.sub,
                expiresAt,
                status: 'pending'
            });

            res.status(201).json({
                id: String(invitation._id),
                workspaceId: String(invitation.workspaceId),
                email: invitation.email,
                role: invitation.role,
                token: invitation.token,
                status: invitation.status,
                expiresAt: invitation.expiresAt
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /workspaces/:id/invitations
 *
 * Workspace'in tüm bekleyen davetlerini listeler.
 */
workspacesRouter.get(
    '/:id/invitations',
    requireAuth,
    (req, _res, next) => { req.query.workspaceId = req.params.id; next(); },
    resolveTenant,
    resolveMember,
    requirePermission('member:read'),
    async (req, res, next) => {
        try {
            const invitations = await Invitation.find({
                workspaceId: req.workspaceId,
                status: 'pending'
            }).sort({ createdAt: -1 });

            res.json(
                invitations.map((inv) => ({
                    id: String(inv._id),
                    email: inv.email,
                    role: inv.role,
                    status: inv.status,
                    token: inv.token,
                    expiresAt: inv.expiresAt,
                    createdAt: inv.createdAt
                }))
            );
        } catch (err) {
            next(err);
        }
    }
);

/**
 * DELETE /workspaces/:id/invitations/:invitationId
 *
 * Bir daveti iptal/iptal eder (status: 'revoked').
 */
workspacesRouter.delete(
    '/:id/invitations/:invitationId',
    requireAuth,
    (req, _res, next) => { req.query.workspaceId = req.params.id; next(); },
    resolveTenant,
    resolveMember,
    requirePermission('member:manage'),
    async (req, res, next) => {
        try {
            const invitation = await Invitation.findOne({
                _id: req.params.invitationId,
                workspaceId: req.workspaceId
            });

            if (!invitation) {
                return res.status(404).json({ error: 'Invitation not found' });
            }

            invitation.status = 'revoked';
            await invitation.save();

            res.json({ ok: true, message: 'Invitation revoked' });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /workspaces/:id/members
 *
 * Workspace'in tüm üyelerini listeler (User detayları ile).
 */
workspacesRouter.get(
    '/:id/members',
    requireAuth,
    (req, _res, next) => { req.query.workspaceId = req.params.id; next(); },
    resolveTenant,
    resolveMember,
    requirePermission('member:read'),
    async (req, res, next) => {
        try {
            const memberships = await Membership.find({ workspaceId: req.workspaceId });
            const userIds = memberships.map((m) => m.userId);
            const users = await User.find({ _id: { $in: userIds } }).select('name email avatarUrl');

            const members = memberships.map((m) => {
                const user = users.find((u) => String(u._id) === String(m.userId));
                return {
                    id: String(m._id),
                    userId: String(m.userId),
                    role: m.role,
                    name: user?.name || 'Unknown',
                    email: user?.email || '',
                    avatarUrl: user?.avatarUrl,
                    joinedAt: m.createdAt
                };
            });

            res.json(members);
        } catch (err) {
            next(err);
        }
    }
);

