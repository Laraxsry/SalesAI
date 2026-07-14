import { Membership } from '@repo/database';

/**
 * Tenant Middleware — Workspace Üyelik Çözümleme
 *
 * Bu middleware ne yapar?
 * Bir kullanıcı korumalı bir endpoint'e istek attığında, hangi workspace
 * üzerinde işlem yaptığını ve o workspace'teki rolünü belirler.
 *
 * Akış:
 * 1. Request header veya body'den workspaceId alır
 * 2. Kullanıcının o workspace'e üye olup olmadığını kontrol eder
 * 3. Üyeyse, req.member'a rolünü (OWNER/ADMIN/EDITOR/VIEWER) atar
 * 4. Üye değilse 403 Forbidden döner
 *
 * Neden gerekli?
 * RBAC (Role-Based Access Control) sistemi buna dayanır.
 * `requirePermission('product:create')` gibi middleware'ler
 * `req.member.role` değerine bakarak izin verir/reddeder.
 *
 * workspaceId şu kaynaklardan alınır (öncelik sırası):
 * 1. req.body.workspaceId (POST istekleri)
 * 2. req.query.workspaceId (GET istekleri)
 * 3. req.headers['x-workspace-id'] (header ile gönderim)
 */
export function resolveTenant(req, res, next) {
    const workspaceId =
        req.body?.workspaceId || req.query?.workspaceId || req.headers['x-workspace-id'];

    if (!workspaceId) {
        return res.status(400).json({ error: 'workspaceId is required' });
    }

    req.workspaceId = workspaceId;
    next();
}

/**
 * Kullanıcının workspace üyeliğini çözümler ve req.member'a atar.
 * requireAuth'dan sonra çalışmalı (req.user gerekli).
 */
export async function resolveMember(req, res, next) {
    try {
        const membership = await Membership.findOne({
            workspaceId: req.workspaceId,
            userId: req.user.sub
        });

        if (!membership) {
            return res.status(403).json({ error: 'Not a member of this workspace' });
        }

        // req.member.role → RBAC kontrollerinde kullanılır
        req.member = { role: membership.role, membershipId: String(membership._id) };
        next();
    } catch (err) {
        next(err);
    }
}
