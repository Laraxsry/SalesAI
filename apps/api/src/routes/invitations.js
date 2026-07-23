import { Router } from 'express';
import { Invitation, Membership } from '@repo/database';
import { requireAuth } from '@repo/auth';

export const invitationsRouter = Router();

/**
 * POST /api/v1/invitations/:token/accept
 *
 * Davet token'ını kabul eder ve oturum açmış kullanıcıyı workspace'e üye olarak ekler.
 */
invitationsRouter.post('/:token/accept', requireAuth, async (req, res, next) => {
    try {
        const { token } = req.params;
        const invitation = await Invitation.findOne({ token, status: 'pending' });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found or no longer active' });
        }

        if (invitation.expiresAt < new Date()) {
            invitation.status = 'expired';
            await invitation.save();
            return res.status(400).json({ error: 'Invitation token has expired' });
        }

        // Zaten üye mi?
        const existingMembership = await Membership.findOne({
            workspaceId: invitation.workspaceId,
            userId: req.user.sub
        });

        let membership = existingMembership;
        if (!existingMembership) {
            membership = await Membership.create({
                workspaceId: invitation.workspaceId,
                userId: req.user.sub,
                role: invitation.role
            });
        }

        invitation.status = 'accepted';
        await invitation.save();

        res.json({
            ok: true,
            message: 'Invitation accepted successfully',
            workspaceId: String(invitation.workspaceId),
            membershipId: String(membership._id),
            role: membership.role
        });
    } catch (err) {
        next(err);
    }
});
