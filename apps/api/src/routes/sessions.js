import { Router } from 'express';
import { validate } from '@repo/validation';
import { CreateSessionInput } from '@repo/contracts';
import { ShareLink, Agent, Session } from '@repo/database';
import { createAccessToken, livekitUrl } from '@repo/livekit';
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

        const agent = await Agent.findById(link.agentId);
        if (!agent || agent.status !== 'active') {
            return res.status(409).json({ error: 'Agent is not active' });
        }

        const roomName = `s_${shortId()}`;
        const identity = `visitor_${shortId(8)}`;

        await Session.create({
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

        res.json({ roomName, token, livekitUrl: livekitUrl() });
    } catch (err) {
        next(err);
    }
});
