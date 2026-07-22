import { Router } from 'express';
import { AuditLog } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { resolveTenant, resolveMember } from '../middleware/tenant.js';
import { requirePermission } from '@repo/access';

export const auditLogsRouter = Router();

/**
 * GET /audit-logs
 * Phase 8 Task 3.9: Workspace admin/owner için filtrelenmiş, sayfalı audit log listesi.
 *
 * Query params:
 * - workspaceId (required, via resolveTenant)
 * - action: AUDIT_ACTIONS enum değeri
 * - actorId: userId veya apiKeyId
 * - from: ISO date string (dahil)
 * - to: ISO date string (dahil)
 * - limit: max 100, default 50
 * - cursor: son kaydın _id'si (cursor-based pagination)
 *
 * Güvenlik: Sadece OWNER ve ADMIN erişebilir.
 * `audit:read` permission'ı OWNER ve ADMIN'e tanımlanmış (@repo/access).
 */
auditLogsRouter.get('/', requireAuth, resolveTenant, resolveMember, requirePermission('audit:read'), async (req, res, next) => {
    try {
        const {
            action,
            actorId,
            from,
            to,
            limit = 50,
            cursor
        } = req.query;

        const filter = { workspaceId: req.workspaceId };

        if (action) filter.action = action;
        if (actorId) filter.actorId = actorId;
        if (from || to) {
            filter.at = {};
            if (from) filter.at.$gte = new Date(from);
            if (to) filter.at.$lte = new Date(to);
        }

        // Cursor-based pagination: bir sonraki sayfada cursor'dan önceki kayıtlar
        if (cursor) {
            filter._id = { $lt: cursor };
        }

        const maxLimit = Math.min(Number(limit), 100);
        const logs = await AuditLog.find(filter)
            .sort({ _id: -1 }) // En yeni önce
            .limit(maxLimit + 1) // +1: sonraki sayfa var mı kontrolü
            .lean();

        const hasMore = logs.length > maxLimit;
        const results = hasMore ? logs.slice(0, maxLimit) : logs;
        const nextCursor = hasMore ? String(results[results.length - 1]._id) : null;

        res.json({
            results,
            nextCursor,
            hasMore,
            total: results.length
        });
    } catch (err) {
        next(err);
    }
});
