import { Schema, model } from 'mongoose';

const SessionSchema = new Schema(
    {
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
        shareLinkId: { type: Schema.Types.ObjectId, ref: 'ShareLink', index: true },
        roomName: { type: String, required: true, index: true },
        visitorName: { type: String },
        // Mobile Phase 3: optional lightweight visitor identity, set when the
        // session was minted by a device/visitor that registered for push or
        // signed in via magic-link. Lets GET /sessions/mine list a visitor's
        // history across devices without a full account.
        visitorId: { type: Schema.Types.ObjectId, ref: 'Visitor', index: true },
        status: {
            // 'waiting' — multi-participant only: the agent has joined the room
            // but the presentation has not started yet (waiting for the room to
            // fill or for a "shall we start?" answer). Single-participant
            // sessions go straight to 'live'.
            type: String,
            enum: ['waiting', 'live', 'ended', 'failed'],
            default: 'live',
            index: true
        },
        // Everyone who has joined this room. `visitorName`/`visitorId` above
        // stay as the PRIMARY (first) participant for backward compat with
        // analytics/lead extraction; this is the full list for multi-participant
        // meetings. `leftAt` set when they disconnect (kept, not spliced, so the
        // roster history survives).
        participants: {
            type: [
                {
                    _id: false,
                    identity: { type: String, required: true },
                    name: { type: String },
                    // Stable per-visitor id from the visitor's own localStorage,
                    // used to recognise someone who dropped and rejoined the
                    // same meeting (identity changes on reconnect, this doesn't).
                    visitorKey: { type: String },
                    joinedAt: { type: Date, default: Date.now },
                    leftAt: { type: Date }
                }
            ],
            default: []
        },
        // Pinned from Agent.maxParticipants at session creation (same
        // version-pin idea as the playbook snapshot) so mid-meeting config
        // changes never alter an in-progress room. 1 = single-visitor.
        maxParticipants: { type: Number, default: 1 },
        // Pre-call survey (Agent.preCallSurveyEnabled): the LLM's structured
        // read of what this visitor wants, and the per-visitor tour plan built
        // from it. Both pinned at mint from a server-stashed planToken; the
        // plan runs instead of any static Playbook for this session.
        preCallIntent: { type: Schema.Types.Mixed },
        generatedPlan: { type: Schema.Types.Mixed },
        screenMode: {
            type: String,
            enum: ['none', 'guided-tour', 'customer-share'],
            default: 'none'
        },
        startedAt: { type: Date, default: Date.now },
        endedAt: { type: Date },
        // Heartbeat from agent-worker while the room connection is alive — lets
        // close-stale-sessions detect a truly dead session (worker crashed,
        // no clean disconnect) within minutes instead of waiting on a fixed
        // session-age cutoff that would risk cutting off genuinely long calls.
        lastActivityAt: { type: Date, default: Date.now, index: true },
        // rolled-up analytics (durations, topics, sentiment)
        summary: { type: Schema.Types.Mixed },
        // Phase 5: which channel started this session, for web-vs-widget
        // segmentation in Phase 4 analytics.
        source: { type: String, enum: ['link', 'widget'], default: 'link', index: true },
        pageUrl: { type: String },
        referrer: { type: String },
        // Phase 3: Single-use transient auth tokens (cookies/localStorage) for session handover.
        transientAuth: { type: Schema.Types.Mixed },
        // Contact info the agent read back to the visitor and got explicit
        // confirmation on (via the save_contact_info tool), written live
        // during the call — higher confidence than extract-lead's post-call
        // regex parse of the raw transcript.
        confirmedContact: {
            name: { type: String },
            email: { type: String },
            phone: { type: String }
        }
    },
    { timestamps: true }
);

export const Session = model('Session', SessionSchema);
