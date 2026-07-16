import { Router } from 'express';
import { Agent, Session, Message } from '@repo/database';
import { requireAuth } from '@repo/auth';

export const analyticsRouter = Router();

/** Get analytics for a specific agent. */
analyticsRouter.get('/agents/:id', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        // Fetch all sessions for this agent
        const sessions = await Session.find({ agentId: agent._id });
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

        res.json({
            agentId: String(agent._id),
            totalSessions,
            statusBreakdown,
            totalMessages,
            averageDurationSeconds
        });
    } catch (err) {
        next(err);
    }
});
