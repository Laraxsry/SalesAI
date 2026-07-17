import { Router } from 'express';
import { Agent, Session, Message, SessionSummary, AnalyticsRollup, Lead, Product } from '@repo/database';
import { requireAuth } from '@repo/auth';

export const analyticsRouter = Router();

/**
 * GET /analytics/agents/:id
 * KPI'lar: toplam session, avg süre, completion/unanswered rate + isteğe bağlı date range.
 * AnalyticsRollup varsa kullanır, yoksa anlık hesaplar.
 *
 * 03_data_model_and_api.md: GET /api/v1/analytics/agents/:id
 */
analyticsRouter.get('/agents/:id', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const { from, to } = req.query;
        const dateFilter = {};
        if (from) dateFilter.$gte = new Date(from);
        if (to) dateFilter.$lte = new Date(to);

        const sessionFilter = { agentId: agent._id };
        if (from || to) sessionFilter.startedAt = dateFilter;

        // Fetch all sessions for this agent
        const sessions = await Session.find(sessionFilter);
        const totalSessions = sessions.length;

        // Calculate session status breakdown and durations
        const statusBreakdown = { live: 0, ended: 0, failed: 0 };
        let totalDurationMs = 0;
        let endedSessionsCount = 0;

        for (const s of sessions) {
            if (s.status === 'live') statusBreakdown.live++;
            else if (s.status === 'ended') statusBreakdown.ended++;
            else if (s.status === 'failed') statusBreakdown.failed++;

            if (s.startedAt && s.endedAt) {
                totalDurationMs += new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
                endedSessionsCount++;
            }
        }

        const averageDurationSeconds = endedSessionsCount > 0
            ? Math.round((totalDurationMs / endedSessionsCount) / 1000)
            : 0;

        // Total messages count for all sessions of this agent, plus direct text messages (chat)
        const sessionIds = sessions.map(s => s._id);
        const totalMessages = await Message.countDocuments({
            $or: [
                { sessionId: { $in: sessionIds } },
                { agentId: agent._id }
            ]
        });

        // Phase 4: completion rate + unanswered rate (SessionSummary'den)
        let completionRate = 0;
        let unansweredRate = 0;
        if (endedSessionsCount > 0) {
            const endedIds = sessions.filter(s => s.status === 'ended').map(s => s._id);
            const summaries = await SessionSummary.find({ sessionId: { $in: endedIds } }, 'dropOff unanswered').lean();
            const withDropOff = summaries.filter(s => s.dropOff > 0).length;
            const withUnanswered = summaries.filter(s => s.unanswered && s.unanswered.length > 0).length;
            completionRate = summaries.length > 0 ? withDropOff / summaries.length : 0;
            unansweredRate = summaries.length > 0 ? withUnanswered / summaries.length : 0;
        }

        // Phase 4: AnalyticsRollup'tan time series (son 30 günlük saatlik bucketler)
        const rollupFilter = { scope: 'agent', scopeId: agent._id, bucket: 'hour' };
        if (from || to) {
            rollupFilter.bucketAt = {};
            if (from) rollupFilter.bucketAt.$gte = new Date(from);
            if (to) rollupFilter.bucketAt.$lte = new Date(to);
        } else {
            rollupFilter.bucketAt = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
        }
        const timeSeries = await AnalyticsRollup.find(rollupFilter).sort({ bucketAt: 1 }).lean();

        res.json({
            agentId: String(agent._id),
            totalSessions,
            statusBreakdown,
            totalMessages,
            averageDurationSeconds,
            completionRate: Math.round(completionRate * 100) / 100,
            unansweredRate: Math.round(unansweredRate * 100) / 100,
            timeSeries
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /analytics/agents/:id/summary
 * Bu agent'ın son SessionSummary'lerini sayfalı döner.
 *
 * Query: limit, skip
 */
analyticsRouter.get('/agents/:id/summary', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const { limit = 20, skip = 0 } = req.query;

        // Bu agent'a ait session'ların ID'lerini bul
        const sessions = await Session.find({ agentId: agent._id }, '_id').lean();
        const sessionIds = sessions.map(s => s._id);

        const summaries = await SessionSummary.find({ sessionId: { $in: sessionIds } })
            .sort({ generatedAt: -1 })
            .skip(Number(skip))
            .limit(Math.min(Number(limit), 100))
            .lean();

        const total = await SessionSummary.countDocuments({ sessionId: { $in: sessionIds } });

        res.json({ total, summaries });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /analytics/products/:id/topics
 * Ürün bazında en sık konuşulan konular ve itirazlar.
 *
 * 03_data_model_and_api.md: GET /api/v1/analytics/products/:id/topics
 */
analyticsRouter.get('/products/:id/topics', requireAuth, async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const { from, to, limit = 10 } = req.query;

        // Bu product'a ait agent'ları bul
        const agents = await Agent.find({ productId: product._id }, '_id').lean();
        const agentIds = agents.map(a => a._id);

        // Bu agent'lara ait session'ları bul
        const sessionFilter = { agentId: { $in: agentIds } };
        if (from || to) {
            sessionFilter.startedAt = {};
            if (from) sessionFilter.startedAt.$gte = new Date(from);
            if (to) sessionFilter.startedAt.$lte = new Date(to);
        }
        const sessions = await Session.find(sessionFilter, '_id').lean();
        const sessionIds = sessions.map(s => s._id);

        // Tüm summary'lerden topics ve objections topla
        const summaries = await SessionSummary.find(
            { sessionId: { $in: sessionIds } },
            'topics objections'
        ).lean();

        const topicCount = {};
        const objectionCount = {};

        for (const s of summaries) {
            for (const t of (s.topics || [])) {
                topicCount[t] = (topicCount[t] || 0) + 1;
            }
            for (const o of (s.objections || [])) {
                objectionCount[o] = (objectionCount[o] || 0) + 1;
            }
        }

        const topTopics = Object.entries(topicCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, Number(limit))
            .map(([topic, count]) => ({ topic, count }));

        const topObjections = Object.entries(objectionCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, Number(limit))
            .map(([objection, count]) => ({ objection, count }));

        res.json({ productId: String(product._id), topTopics, topObjections });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /analytics/leads
 * Workspace'e göre lead listesi (sayfalı).
 *
 * Query: workspaceId (required), status, minScore, limit, skip
 *
 * 03_data_model_and_api.md: GET /api/v1/analytics/leads
 */
analyticsRouter.get('/leads', requireAuth, async (req, res, next) => {
    try {
        const { workspaceId, status, minScore, limit = 20, skip = 0 } = req.query;
        if (!workspaceId) return res.status(400).json({ error: 'workspaceId zorunlu' });

        const filter = { workspaceId };
        if (status) filter.status = status;
        if (minScore) filter.score = { $gte: Number(minScore) };

        const [leads, total] = await Promise.all([
            Lead.find(filter)
                .sort({ score: -1, createdAt: -1 })
                .skip(Number(skip))
                .limit(Math.min(Number(limit), 100))
                .lean(),
            Lead.countDocuments(filter)
        ]);

        res.json({ total, leads });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /analytics/knowledge-gaps
 * Ürün başına unanswered sorular raporu.
 * Seller'ın ne içerik eklemesi gerektiğini gösterir.
 *
 * Query: productId (required), limit
 */
analyticsRouter.get('/knowledge-gaps', requireAuth, async (req, res, next) => {
    try {
        const { productId, limit = 20 } = req.query;
        if (!productId) return res.status(400).json({ error: 'productId zorunlu' });

        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        // Bu product'a ait agent'lar → session'lar → summary'ler
        const agents = await Agent.find({ productId: product._id }, '_id').lean();
        const agentIds = agents.map(a => a._id);
        const sessions = await Session.find({ agentId: { $in: agentIds } }, '_id').lean();
        const sessionIds = sessions.map(s => s._id);

        const summaries = await SessionSummary.find(
            { sessionId: { $in: sessionIds }, 'unanswered.0': { $exists: true } },
            'unanswered'
        ).lean();

        // Unanswered soruları say
        const gapCount = {};
        for (const s of summaries) {
            for (const q of (s.unanswered || [])) {
                const normalized = q.trim().toLowerCase();
                gapCount[normalized] = (gapCount[normalized] || 0) + 1;
            }
        }

        const gaps = Object.entries(gapCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, Number(limit))
            .map(([question, count]) => ({ question, count }));

        res.json({ productId: String(product._id), gaps });
    } catch (err) {
        next(err);
    }
});
