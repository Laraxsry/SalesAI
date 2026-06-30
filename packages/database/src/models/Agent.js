import { Schema, model } from 'mongoose';

const AgentSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
        name: { type: String, required: true },
        status: {
            type: String,
            enum: ['draft', 'active', 'paused', 'archived'],
            default: 'draft',
            index: true
        },
        persona: {
            tone: { type: String, default: 'friendly, expert, concise' },
            language: { type: String, default: 'en' },
            goals: { type: [String], default: [] },
            guardrails: { type: [String], default: [] }
        },
        avatarProvider: {
            type: String,
            enum: ['voice-only', 'tavus', 'simli', 'heygen', 'did'],
            default: 'voice-only'
        },
        screenModes: {
            type: [String],
            enum: ['none', 'guided-tour', 'customer-share'],
            default: ['guided-tour', 'customer-share']
        },
        toolAccess: {
            enabled: { type: Boolean, default: false },
            baseUrl: { type: String },
            openApiUrl: { type: String },
            mcpUrl: { type: String }
        }
    },
    { timestamps: true }
);

export const Agent = model('Agent', AgentSchema);
