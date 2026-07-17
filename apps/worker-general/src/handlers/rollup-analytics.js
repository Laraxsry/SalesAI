import { Session, SessionSummary, AnalyticsRollup, Agent } from '@repo/database';
import { Logger } from '@repo/logger';

/**
 * Belirli bir bucket (hour veya day) için AnalyticsRollup hesaplar.
 *
 * Tasarım kararı (architecture.md — Risks: Rollup drift):
 *   Jobs idempotent ve re-runnable — upsert pattern sayesinde aynı bucket
 *   birden çok çalıştırılsa da sonuç tutarlı kalır.
 *
 * @param {{ scope: 'agent'|'product', scopeId: string, bucket: 'hour'|'day', bucketAt: Date }} data
 */
export async function rollupAnalytics({ scope, scopeId, bucket, bucketAt }) {
    Logger.info('[rollup-analytics] başlıyor', { scope, scopeId, bucket, bucketAt });

    // ── 1. Bucket zaman aralığını hesapla ──────────────────────────────────────
    const bucketStart = new Date(bucketAt);
    bucketStart.setMinutes(0, 0, 0);
    if (bucket === 'day') bucketStart.setHours(0, 0, 0, 0);

    const bucketEnd = new Date(bucketStart);
    if (bucket === 'hour') bucketEnd.setHours(bucketEnd.getHours() + 1);
    else bucketEnd.setDate(bucketEnd.getDate() + 1);

    // ── 2. Bu scope'a ait session'ları bul ────────────────────────────────────
    let agentIds = [];
    if (scope === 'agent') {
        agentIds = [scopeId];
    } else {
        // product scope: önce bu product'a ait tüm agent'ları bul
        const agents = await Agent.find({ productId: scopeId }, '_id').lean();
        agentIds = agents.map(a => String(a._id));
    }

    const sessions = await Session.find({
        agentId: { $in: agentIds },
        startedAt: { $gte: bucketStart, $lt: bucketEnd }
    }).lean();

    const totalSessions = sessions.length;

    // ── 3. Ortalama süre hesapla ───────────────────────────────────────────────
    const endedSessions = sessions.filter(s => s.status === 'ended' && s.startedAt && s.endedAt);
    let avgDurationSec = 0;
    if (endedSessions.length > 0) {
        const totalMs = endedSessions.reduce((sum, s) => {
            return sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime());
        }, 0);
        avgDurationSec = Math.round(totalMs / endedSessions.length / 1000);
    }

    // ── 4. Completion rate ─────────────────────────────────────────────────────
    // dropOff === 0 → ziyaretçi ilk mesajdan sonra ayrılmış → tamamlanmamış
    let completionRate = 0;
    if (endedSessions.length > 0) {
        const sessionIds = endedSessions.map(s => s._id);
        const summaries = await SessionSummary.find(
            { sessionId: { $in: sessionIds } },
            'dropOff'
        ).lean();

        const summaryMap = new Map(summaries.map(s => [String(s.sessionId), s]));
        const completedCount = endedSessions.filter(s => {
            const sum = summaryMap.get(String(s._id));
            return sum && sum.dropOff > 0;
        }).length;
        completionRate = completedCount / endedSessions.length;
    }

    // ── 5. Unanswered rate ────────────────────────────────────────────────────
    let unansweredRate = 0;
    if (endedSessions.length > 0) {
        const sessionIds = endedSessions.map(s => s._id);
        const summariesWithUnanswered = await SessionSummary.countDocuments({
            sessionId: { $in: sessionIds },
            'unanswered.0': { $exists: true }
        });
        unansweredRate = summariesWithUnanswered / endedSessions.length;
    }

    // ── 6. Idempotent upsert ───────────────────────────────────────────────────
    await AnalyticsRollup.updateOne(
        { scope, scopeId, bucket, bucketAt: bucketStart },
        {
            $set: {
                metrics: { sessions: totalSessions, avgDurationSec, completionRate, unansweredRate }
            }
        },
        { upsert: true }
    );

    Logger.info('[rollup-analytics] tamamlandı', {
        scope, scopeId, bucket, bucketAt: bucketStart.toISOString(),
        metrics: { totalSessions, avgDurationSec, completionRate, unansweredRate }
    });
}
