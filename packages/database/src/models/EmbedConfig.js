import { Schema, model } from 'mongoose';

/**
 * Per-agent widget settings for the embeddable SDK (Phase 5).
 *
 * One config per agent (unique agentId). Only non-secret render settings live
 * here — this document is ultimately served to anonymous visitors through the
 * public embed config endpoint, so nothing sensitive may ever be added to it.
 * The domain allowlist is a separate collection (EmbedDomain) so entries can
 * carry their own verification state and be indexed for origin lookups.
 */
const EmbedConfigSchema = new Schema(
    {
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, unique: true, index: true },
        theme: {
            primaryColor: { type: String, default: '#4f46e5' },
            mode: { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' }
        },
        launcher: {
            position: { type: String, enum: ['bottom-right', 'bottom-left'], default: 'bottom-right' },
            label: { type: String, default: 'Talk to sales' }
        },
        greeting: { type: String },
        micAutoPrompt: { type: Boolean, default: false },
        // Embed traffic is anonymous and each session costs real money
        // (LiveKit + realtime LLM), so caps are stored per config and enforced
        // by the embed rate-limit middleware.
        rateCaps: {
            sessionsPerIpPerHour: { type: Number, default: 6 },
            sessionsPerOriginPerHour: { type: Number, default: 60 }
        }
    },
    { timestamps: true }
);

export const EmbedConfig = model('EmbedConfig', EmbedConfigSchema);
