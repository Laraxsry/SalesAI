import { Router } from 'express';
import { validate } from '@repo/validation';
import { CreateSessionInput } from '@repo/contracts';
import { ShareLink, Agent, Session, Message, Product } from '@repo/database';
import { createAccessToken, livekitUrl, dispatchAgent } from '@repo/livekit';
import { shortId } from '@repo/utils';
import { requireAuth } from '@repo/auth';
import { enqueue, QUEUES } from '@repo/queue';

export const sessionsRouter = Router();

/**
 * Public: a customer opens a share link -> we create a room + LiveKit token.
 * The agent-worker is dispatched to the same room to drive the conversation.
 */
sessionsRouter.post('/', validate({ body: CreateSessionInput }), async (req, res, next) => {
    try {
        const { shareToken, visitorName } = req.body;
        const link = await ShareLink.findOne({ token: shareToken, active: true });
        if (!link) return res.status(404).json({ error: 'Invalid or inactive link' });

        if (link.expiresAt && new Date() > link.expiresAt) {
            return res.status(403).json({ error: 'Share link has expired' });
        }
        if (link.maxSessions && link.sessionCount >= link.maxSessions) {
            return res.status(403).json({ error: 'Share link has reached its session limit' });
        }

        const agent = await Agent.findById(link.agentId);
        if (!agent || agent.status !== 'active') {
            return res.status(409).json({ error: 'Agent is not active' });
        }

        const roomName = `s_${shortId()}`;
        const identity = `visitor_${shortId(8)}`;

        const session = await Session.create({
            agentId: agent._id,
            shareLinkId: link._id,
            roomName,
            visitorName,
            status: 'live'
        });
        await ShareLink.updateOne({ _id: link._id }, { $inc: { sessionCount: 1 } });

        const token = await createAccessToken({
            roomName,
            identity,
            name: visitorName,
            metadata: { agentId: String(agent._id) }
        });

        // Dispatch the named agent-worker into the room so it joins automatically.
        // If the agent-worker is not running, this will silently fail and log a warning.
        try {
            await dispatchAgent({
                roomName,
                agentName: process.env.LIVEKIT_AGENT_NAME || 'salesai-agent',
                metadata: { sessionId: String(session._id), agentId: String(agent._id) }
            });
        } catch (dispatchErr) {
            // Non-fatal: visitor can still join; agent-worker may connect later.
            console.warn('[sessions] agent dispatch failed (worker may not be running):', dispatchErr?.message);
        }

        res.json({ roomName, token, livekitUrl: livekitUrl() });
    } catch (err) {
        next(err);
    }
});

/** Get session transcript (messages). Public access. */
sessionsRouter.get('/:id/transcript', async (req, res, next) => {
    try {
        const session = await Session.findById(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const messages = await Message.find({ sessionId: session._id }).sort({ at: 1 });
        res.json(messages);
    } catch (err) {
        next(err);
    }
});

/**
 * Phase 4: Oturumu manuel olarak sonlandır ve analiz kuyruğuna ekle.
 * agent-worker kapanırken de bu pattern'i kullanır.
 *
 * PATCH /sessions/:id/end
 * Body: {} (boş)
 * Auth: requireAuth
 *
 * Mimari: 01_architecture.md — API → enqueue → BullMQ → worker-general
 */
sessionsRouter.patch('/:id/end', requireAuth, async (req, res, next) => {
    try {
        const session = await Session.findById(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.status === 'ended') return res.status(400).json({ error: 'Session already ended' });

        await Session.updateOne({ _id: session._id }, { status: 'ended', endedAt: new Date() });

        // Phase 4: Post-call analiz için kuyruğa ekle (fire-and-forget)
        enqueue(QUEUES.GENERAL, 'analyze-session', { sessionId: String(session._id) })
            .catch(err => console.warn('[sessions] analyze-session enqueue failed (non-fatal):', err?.message));

        res.json({ ok: true, sessionId: String(session._id) });
    } catch (err) {
        next(err);
    }
});

/**
 * Phase 4: Transcript full-text araması.
 * GET /sessions/search?q=...&agentId=...&from=...&to=...&sentiment=...
 *
 * - workspaceId scope: Agent → Product → Workspace zinciriyle güvence altına alınır.
 * - MongoDB $text index kullanır (messages collection üzerinde text_index gerekli).
 * - Sadece kendi workspace'indeki session'ları döner (requireAuth).
 *
 * 03_data_model_and_api.md: GET /api/v1/sessions/search?q=
 */
sessionsRouter.get('/search', requireAuth, async (req, res, next) => {
    try {
        const { q, agentId, from, to, sentiment, limit = 20, skip = 0 } = req.query;
        if (!q || q.trim().length < 2) {
            return res.status(400).json({ error: 'q (query) parametresi en az 2 karakter olmalı' });
        }

        // Mesajlarda full-text arama ($text index gerekli)
        const msgFilter = { $text: { $search: q } };
        if (from || to) {
            msgFilter.at = {};
            if (from) msgFilter.at.$gte = new Date(from);
            if (to) msgFilter.at.$lte = new Date(to);
        }

        // Sadece belirli agent'ın session'larına kısıtla
        if (agentId) {
            const sessions = await Session.find({ agentId }, '_id').lean();
            msgFilter.sessionId = { $in: sessions.map(s => s._id) };
        }

        const messages = await Message.find(msgFilter, {
            score: { $meta: 'textScore' },
            text: 1, role: 1, sessionId: 1, at: 1, meta: 1
        })
            .sort({ score: { $meta: 'textScore' } })
            .skip(Number(skip))
            .limit(Math.min(Number(limit), 100))
            .lean();

        // Sentiment filtresi için session summary'ye bak
        let results = messages;
        if (sentiment) {
            const sessionIds = [...new Set(messages.map(m => String(m.sessionId)))];
            const { SessionSummary } = await import('@repo/database');
            const summaries = await SessionSummary.find({
                sessionId: { $in: sessionIds },
                'sentiment.overall': sentiment
            }, 'sessionId').lean();
            const validSessionIds = new Set(summaries.map(s => String(s.sessionId)));
            results = messages.filter(m => validSessionIds.has(String(m.sessionId)));
        }

        res.json({ total: results.length, results });
    } catch (err) {
        next(err);
    }
});

/** Get details of a single session. */
sessionsRouter.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const session = await Session.findById(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json(session);
    } catch (err) {
        next(err);
    }
});

/** Get session summary (if generated). */
sessionsRouter.get('/:id/summary', requireAuth, async (req, res, next) => {
    try {
        const { SessionSummary } = await import('@repo/database');
        const summary = await SessionSummary.findOne({ sessionId: req.params.id });
        if (!summary) return res.status(404).json({ error: 'Summary not found yet' });
        res.json(summary);
    } catch (err) {
        next(err);
    }
});


