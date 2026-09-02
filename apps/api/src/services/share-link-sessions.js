import { context, propagation } from '@opentelemetry/api';
import { ShareLink, Agent, Session } from '@repo/database';
import { createAccessToken, livekitUrl, dispatchAgent, roomService } from '@repo/livekit';
import { shortId } from '@repo/utils';
import { getWorkspaceUsageAndQuotas } from './billing-service.js';
import { consumePlanToken } from './pre-call-plan-store.js';

/**
 * Decides whether a new visitor for a multi-participant agent should JOIN an
 * existing meeting room or start a fresh one. Pure — takes the already-fetched
 * candidate sessions so it can be unit-tested without a DB.
 *
 * Rules:
 *  - maxParticipants <= 1  → always 'create' (original single-visitor path).
 *  - otherwise → 'join' the OLDEST 'waiting'/'live' room with a free seat
 *    (participants without a leftAt < maxParticipants);
 *  - 'full' when there IS an active meeting for this link but every one is at
 *    capacity — one meeting per link at a time, so we reject instead of
 *    silently spinning up a parallel room;
 *  - 'create' only when there's no active meeting at all.
 *
 * @param {{ candidateSessions?: Array<object>, maxParticipants?: number }} input
 * @returns {{ action: 'create' } | { action: 'join', session: object } | { action: 'full' }}
 */
export function pickSessionForJoin({ candidateSessions, maxParticipants }) {
    if (!maxParticipants || maxParticipants <= 1) return { action: 'create' };
    const seatOf = (s) => (s.participants || []).filter((p) => !p.leftAt).length;
    const active = (candidateSessions || []).filter(
        (s) => s.status === 'waiting' || s.status === 'live'
    );
    const joinable = active
        .filter((s) => seatOf(s) < maxParticipants)
        .sort(
            (a, b) =>
                new Date(a.createdAt || a.startedAt || 0).getTime() -
                new Date(b.createdAt || b.startedAt || 0).getTime()
        );
    if (joinable.length) return { action: 'join', session: joinable[0] };
    if (active.length) return { action: 'full' };
    return { action: 'create' };
}

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
 * @param {object} [params.transientAuth] - Phase 3: Single-use cookies/localStorage for session handover
 * @param {string} [params.visitorId] - Mobile Phase 3: lightweight visitor identity for GET /sessions/mine
 */
export async function mintSession({ link, agent, visitorName, source = 'link', pageUrl, referrer, transientAuth, visitorId, visitorKey, planToken }) {
    const identity = `visitor_${shortId(8)}`;
    const maxParticipants = Math.max(1, Number(agent.maxParticipants) || 1);
    const key = typeof visitorKey === 'string' && visitorKey ? visitorKey.slice(0, 64) : undefined;

    // Görev #7 — pre-call survey result (1-on-1 only). The stashed plan runs
    // instead of any static Playbook for this session.
    const preCall =
        maxParticipants === 1 && planToken ? await consumePlanToken(planToken, link.token) : null;

    // ── Multi-participant: join an already-running meeting if there's a seat ──
    if (maxParticipants > 1) {
        const candidates = await Session.find({
            shareLinkId: link._id,
            status: { $in: ['waiting', 'live'] }
        }).sort({ createdAt: 1 });
        const pick = pickSessionForJoin({ candidateSessions: candidates, maxParticipants });
        if (pick.action === 'full') {
            throw Object.assign(
                new Error('Bu oturum şu anda dolu. Lütfen biraz sonra tekrar deneyin.'),
                { httpStatus: 409 }
            );
        }
        if (pick.action === 'join') {
            const s = pick.session;
            await Session.updateOne(
                { _id: s._id },
                { $push: { participants: { identity, name: visitorName, visitorKey: key, joinedAt: new Date() } } }
            );
            const token = await createAccessToken({
                roomName: s.roomName,
                identity,
                name: visitorName,
                metadata: { agentId: String(agent._id), sessionId: String(s._id), visitorKey: key }
            });
            // No dispatchAgent — the agent-worker is already in this room.
            return {
                sessionId: String(s._id),
                roomName: s.roomName,
                token,
                livekitUrl: livekitUrl(),
                avatarProvider: agent.avatarProvider,
                maxParticipants,
                joined: true
            };
        }
    }

    // ── Create a fresh room (also the only path when maxParticipants === 1) ──
    const roomName = `s_${shortId()}`;
    const status = maxParticipants > 1 ? 'waiting' : 'live';

    const session = await Session.create({
        agentId: agent._id,
        shareLinkId: link._id,
        roomName,
        visitorName,
        status,
        source,
        pageUrl,
        referrer,
        transientAuth,
        visitorId: visitorId || undefined,
        maxParticipants,
        participants: [{ identity, name: visitorName, visitorKey: key, joinedAt: new Date() }],
        preCallIntent: preCall?.intent,
        generatedPlan: preCall?.plan
    });
    await ShareLink.updateOne({ _id: link._id }, { $inc: { sessionCount: 1 } });

    if (maxParticipants > 1) {
        // Pre-create the room with a hard SFU-level cap (+1 for the agent, who
        // is not counted in the seller-facing number) so an over-capacity join
        // is rejected even if our own seat check races.
        try {
            await roomService().createRoom({
                name: roomName,
                maxParticipants: maxParticipants + 1,
                emptyTimeout: 300
            });
        } catch (roomErr) {
            console.warn('[sessions] room pre-create failed (non-fatal):', roomErr?.message);
        }
    }

    const token = await createAccessToken({
        roomName,
        identity,
        name: visitorName,
        metadata: { agentId: String(agent._id), sessionId: String(session._id), visitorKey: key }
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

    // avatarProvider rides along so visitor clients (web + mobile) can branch
    // their render (video surface vs. voice-only orb) without a second round
    // trip to fetch the agent — the session response is otherwise self-contained.
    return {
        sessionId: String(session._id),
        roomName,
        token,
        livekitUrl: livekitUrl(),
        avatarProvider: agent.avatarProvider,
        maxParticipants
    };
}
