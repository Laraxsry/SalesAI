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
            type: String,
            enum: ['live', 'ended', 'failed'],
            default: 'live',
            index: true
        },
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
