import { Router } from 'express';
import { Membership } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { can } from '@repo/access';

export const membershipsRouter = Router();

/**
 * PATCH /api/v1/memberships/:id
 *
 * Workspace üyesinin rolünü değiştirir.
 * Body: { "role": "ADMIN" }
 */
membershipsRouter.patch('/:id', requireAuth, async (req, res, next) => {
    try {
        const { role } = req.body;
        const validRoles = ['ADMIN', 'EDITOR', 'VIEWER'];
        if (!role || !validRoles.includes(role)) {
            return res.status(422).json({ error: `Invalid role. Allowed roles: ${validRoles.join(', ')}` });
        }

        const targetMembership = await Membership.findById(req.params.id);
        if (!targetMembership) {
            return res.status(404).json({ error: 'Membership not found' });
        }

        // Çağıran kullanıcının bu workspace'teki üyeliğini kontrol et
        const callerMembership = await Membership.findOne({
            workspaceId: targetMembership.workspaceId,
            userId: req.user.sub
        });

        if (!callerMembership || !can(callerMembership.role, 'member:manage')) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions to manage members' });
        }

        // Owner rolü değiştirilemez
        if (targetMembership.role === 'OWNER') {
            return res.status(400).json({ error: 'Cannot demote or modify the workspace OWNER role' });
        }

        targetMembership.role = role;
        await targetMembership.save();

        res.json({
            id: String(targetMembership._id),
            workspaceId: String(targetMembership.workspaceId),
            userId: String(targetMembership.userId),
            role: targetMembership.role,
            updatedAt: targetMembership.updatedAt
        });
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/v1/memberships/:id
 *
 * Workspace üyesini üyelikten çıkarır.
 */
membershipsRouter.delete('/:id', requireAuth, async (req, res, next) => {
    try {
        const targetMembership = await Membership.findById(req.params.id);
        if (!targetMembership) {
            return res.status(404).json({ error: 'Membership not found' });
        }

        // Çağıran kullanıcının yetki kontrolü
        const callerMembership = await Membership.findOne({
            workspaceId: targetMembership.workspaceId,
            userId: req.user.sub
        });

        if (!callerMembership || !can(callerMembership.role, 'member:manage')) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions to remove members' });
        }

        // Owner üyeliği silinemez
        if (targetMembership.role === 'OWNER') {
            return res.status(400).json({ error: 'Workspace owner cannot be removed' });
        }

        await targetMembership.deleteOne();

        res.json({ ok: true, message: 'Member removed from workspace successfully' });
    } catch (err) {
        next(err);
    }
});
