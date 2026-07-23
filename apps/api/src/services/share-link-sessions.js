import { context, propagation } from '@opentelemetry/api';
import { ShareLink, Agent, Session } from '@repo/database';
import { createAccessToken, livekitUrl, dispatchAgent } from '@repo/livekit';
import { shortId } from '@repo/utils';
import { getWorkspaceUsageAndQuotas } from './billing-service.js';

/**
 * Shared session-minting logic for POST /sessions and POST /embed/:token/session.
 *
 * Both routes open a room against the same underlying `ShareLink`; the widget
 * route (Phase 5) reuses the exact validation and minting rules of the plain
 * share link (Phase 2) instead of re-implementing them, so "is this link
 * still usable" has exactly one definition. What differs between the two
 * callers is everything *around* this: how the token arrives (body vs. URL
 * param), and which extra guards run first (origin allowlist + rate limiting
 * for the embed route only).
 */

/**
 * Looks up a ShareLink by token and checks it (and its agent) are usable.
 * Returns a discriminated result instead of throwing, so route handlers keep
 * full control over the HTTP response shape without a custom error hierarchy.
 *
 * @returns {Promise<{ ok: true, link: object, agent: object } | { ok: false, status: number, error: string }>}
 */
export async function resolveShareLink(token) {
    const link = await ShareLink.findOne({ token, active: true });
    if (!link) return { ok: false, status: 404, error: 'Invalid or inactive link' };

    if (link.expiresAt && new Date() > link.expiresAt) {
        return { ok: false, status: 403, error: 'Share link has expired' };
    }
    if (link.maxSessions && link.sessionCount >= link.maxSessions) {
        return { ok: false, status: 403, error: 'Share link has reached its session limit' };
    }

    const agent = await Agent.findById(link.agentId);
    if (!agent || agent.status !== 'active') {
        return { ok: false, status: 409, error: 'Agent is not active' };
    }

    if (agent.workspaceId) {
        const usageInfo = await getWorkspaceUsageAndQuotas(agent.workspaceId);
        const voiceData = usageInfo.meters?.agentVoiceMinutes;
        if (voiceData && voiceData.isOverQuota) {
            return {
                ok: false,
                status: 402,
                error: 'Quota exceeded: Workspace has reached its limit for agent voice minutes.'
            };
        }
    }

    return { ok: true, link, agent };
}

/**
 * Creates a `Session` + LiveKit room/token for an already-resolved link, and
 * dispatches the agent-worker into the room.
 *
 * @param {object} params
 * @param {object} params.link - resolved ShareLink doc
 * @param {object} params.agent - resolved Agent doc
 * @param {string} [params.visitorName]
 * @param {'link'|'widget'} [params.source='link']
 * @param {string} [params.pageUrl] - Phase 5: the page the widget was opened from
 * @param {string} [params.referrer] - Phase 5: Referer header at session start
 */
export async function mintSession({ link, agent, visitorName, source = 'link', pageUrl, referrer }) {
    const roomName = `s_${shortId()}`;
    const identity = `visitor_${shortId(8)}`;

    const session = await Session.create({
        agentId: agent._id,
        shareLinkId: link._id,
        roomName,
        visitorName,
        status: 'live',
        source,
        pageUrl,
        referrer
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
    //
    // Stashes the current OpenTelemetry trace context in the dispatch metadata
    // (Phase 7 — same mechanism @repo/queue's enqueue() uses for BullMQ jobs),
    // so the agent-worker's own spans and logs nest under this request's trace
    // instead of starting a disconnected one.
    const traceContext = {};
    propagation.inject(context.active(), traceContext);
    try {
        await dispatchAgent({
            roomName,
            agentName: process.env.LIVEKIT_AGENT_NAME || 'salesai-agent',
            metadata: { sessionId: String(session._id), agentId: String(agent._id), __traceContext: traceContext }
        });
    } catch (dispatchErr) {
        // Non-fatal: visitor can still join; agent-worker may connect later.
        console.warn('[sessions] agent dispatch failed (worker may not be running):', dispatchErr?.message);
    }

    return { roomName, token, livekitUrl: livekitUrl() };
}
