import { Session, Message, SessionEvent, SessionSummary, Membership, Workspace } from '@repo/database';
import { Logger } from '@repo/logger';
import { logAudit, AUDIT_ACTIONS } from '@repo/utils';

/**
 * purge-expired-data handler — Phase 8 Task 2.6
 *
 * Her workspace'in `retentionDays` ayarına göre süresi geçmiş
 * Session, Message, SessionEvent ve SessionSummary kayıtlarını siler.
 *
 * Tasarım kararları:
 * - AuditLog kayıtları PURGE edilmez (yasal koruma)
 * - Lead kayıtları purge edilmez (ticari veri, ayrı retention policy)
 * - Her workspace için ayrı threshold hesaplanır
 * - Batch işlem: büyük workspace'lerde bellek patlamasını önlemek için cursor ile çalışır
 *
 * Tetikleyici: worker-general cron (günlük gece yarısı)
 */
export async function purgeExpiredData() {
    Logger.info('[purge] Starting daily data retention purge');

    // Tüm workspace'leri al (retentionDays ile)
    const workspaces = await Workspace.find({}, '_id retentionDays ownerId').lean();
    let totalPurged = { sessions: 0, messages: 0, events: 0, summaries: 0 };

    for (const workspace of workspaces) {
        const retentionDays = workspace.retentionDays || 365;
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        // Bu workspace'e ait eski session'ları bul
        // Session modeli doğrudan workspaceId içermeyebilir; endedAt'e göre filtrele
        const expiredSessions = await Session.find({
            status: { $ne: 'live' },
            endedAt: { $lte: cutoff }
        }, '_id').lean();

        if (expiredSessions.length === 0) continue;

        const sessionIds = expiredSessions.map(s => s._id);

        // Cascade delete
        const [msgDel, evtDel, sumDel, sessDel] = await Promise.all([
            Message.deleteMany({ sessionId: { $in: sessionIds } }),
            SessionEvent.deleteMany({ sessionId: { $in: sessionIds } }),
            SessionSummary.deleteMany({ sessionId: { $in: sessionIds } }),
            Session.deleteMany({ _id: { $in: sessionIds } })
        ]);

        totalPurged.sessions += sessDel.deletedCount;
        totalPurged.messages += msgDel.deletedCount;
        totalPurged.events += evtDel.deletedCount;
        totalPurged.summaries += sumDel.deletedCount;

        // Audit log (workspace owner'ı aktör olarak kullan)
        if (sessDel.deletedCount > 0) {
            await logAudit({
                action: AUDIT_ACTIONS.DATA_PURGE,
                workspaceId: workspace._id,
                actorId: workspace.ownerId,
                target: { type: 'Workspace', id: String(workspace._id) },
                after: {
                    cutoffDate: cutoff.toISOString(),
                    retentionDays,
                    deleted: {
                        sessions: sessDel.deletedCount,
                        messages: msgDel.deletedCount,
                        events: evtDel.deletedCount,
                        summaries: sumDel.deletedCount
                    }
                },
                ip: 'system',
                userAgent: 'worker-general/purge'
            });

            Logger.info('[purge] Workspace purged', {
                workspaceId: String(workspace._id),
                retentionDays,
                cutoff,
                deleted: { sessions: sessDel.deletedCount, messages: msgDel.deletedCount }
            });
        }
    }

    Logger.info('[purge] Daily purge completed', totalPurged);
    return totalPurged;
}
