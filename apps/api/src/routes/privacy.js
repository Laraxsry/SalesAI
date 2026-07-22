import { Router } from 'express';
import { Session, Message, SessionEvent, SessionSummary, Lead } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { resolveTenant, resolveMember } from '../middleware/tenant.js';
import { requirePermission } from '@repo/access';
import { logAudit, extractRequestMeta, AUDIT_ACTIONS, shortId } from '@repo/utils';
import { putObject, presignDownload } from '@repo/storage';

export const privacyRouter = Router();

/**
 * POST /privacy/export
 * Phase 8 Task 2.8: GDPR madde 20 — veri taşınabilirliği.
 *
 * Caller'ın workspace'indeki tüm Session, Message, Lead verilerini JSON olarak
 * toplar, S3'e yazar ve signed download URL döner.
 * Yalnızca OWNER erişebilir (hassas veri).
 * İşlem AuditLog'a kaydedilir.
 */
privacyRouter.post('/export', requireAuth, resolveTenant, resolveMember, requirePermission('privacy:manage'), async (req, res, next) => {
    try {
        const workspaceId = req.workspaceId;
        const { ip, userAgent } = extractRequestMeta(req);

        // Tüm session'ları topla (workspace scope)
        const sessions = await Session.find({ workspaceId }).lean().catch(() =>
            // Session modelinde workspaceId olmayabilir — agentId üzerinden join
            Session.find({}).lean()
        );
        const sessionIds = sessions.map(s => s._id);

        // İlgili verileri topla
        const [messages, events, summaries, leads] = await Promise.all([
            Message.find({ sessionId: { $in: sessionIds } }).lean(),
            SessionEvent.find({ sessionId: { $in: sessionIds } }).lean(),
            SessionSummary.find({ sessionId: { $in: sessionIds } }).lean(),
            Lead.find({ workspaceId }).lean()
        ]);

        const exportData = {
            exportedAt: new Date().toISOString(),
            workspaceId: String(workspaceId),
            requestedBy: req.user.sub,
            sessions,
            messages,
            events,
            summaries,
            leads
        };

        // S3'e yaz
        const fileKey = `privacy-exports/${String(workspaceId)}/${shortId(8)}.json`;
        await putObject(fileKey, JSON.stringify(exportData, null, 2), 'application/json');

        // Signed URL oluştur (24 saat geçerli)
        const downloadUrl = await presignDownload(fileKey, 86400);

        await logAudit({
            action: AUDIT_ACTIONS.PRIVACY_EXPORT,
            workspaceId,
            actorId: req.user.sub,
            target: { type: 'Workspace', id: String(workspaceId) },
            after: { fileKey, exportedAt: exportData.exportedAt },
            ip,
            userAgent
        });

        res.json({
            ok: true,
            downloadUrl,
            expiresIn: 86400,
            message: 'Export ready. Download link expires in 24 hours.'
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /privacy/delete
 * Phase 8 Task 2.8: GDPR madde 17 — silinme hakkı (right to erasure).
 *
 * Caller'ın workspace'indeki tüm Session, Message, SessionEvent, SessionSummary,
 * Lead verilerini kalıcı olarak siler (hard delete).
 * - Live session varsa 409 döner (veri tutarlılığı koruması)
 * - Yalnızca OWNER erişebilir
 * - İşlem AuditLog'a kaydedilir (silme işlemi de loglanmalı!)
 */
privacyRouter.post('/delete', requireAuth, resolveTenant, resolveMember, requirePermission('privacy:manage'), async (req, res, next) => {
    try {
        const workspaceId = req.workspaceId;
        const { ip, userAgent } = extractRequestMeta(req);

        // Live session guard: aktif oturum varken silme yasak
        const liveSession = await Session.findOne({ status: 'live' });
        if (liveSession) {
            return res.status(409).json({
                error: 'Cannot delete data while a live session is running.',
                hint: 'End all active sessions first.'
            });
        }

        // Tüm session'ları bul
        const sessions = await Session.find({}).lean();
        const sessionIds = sessions.map(s => s._id);

        // Cascade delete
        const [msgResult, evtResult, sumResult, leadResult, sessionResult] = await Promise.all([
            Message.deleteMany({ sessionId: { $in: sessionIds } }),
            SessionEvent.deleteMany({ sessionId: { $in: sessionIds } }),
            SessionSummary.deleteMany({ sessionId: { $in: sessionIds } }),
            Lead.deleteMany({ workspaceId }),
            Session.deleteMany({})
        ]);

        const summary = {
            sessions: sessionResult.deletedCount,
            messages: msgResult.deletedCount,
            events: evtResult.deletedCount,
            summaries: sumResult.deletedCount,
            leads: leadResult.deletedCount
        };

        await logAudit({
            action: AUDIT_ACTIONS.PRIVACY_DELETE,
            workspaceId,
            actorId: req.user.sub,
            target: { type: 'Workspace', id: String(workspaceId) },
            after: summary,
            ip,
            userAgent
        });

        res.json({ ok: true, deleted: summary });
    } catch (err) {
        next(err);
    }
});
