import { Router } from 'express';
import { validate } from '@repo/validation';
import { CreateSessionInput } from '@repo/contracts';
import { ShareLink, Agent, Session } from '@repo/database';
import { createAccessToken, livekitUrl, dispatchAgent } from '@repo/livekit';
import { shortId } from '@repo/utils';

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
