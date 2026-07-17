import { Schema, model } from 'mongoose';

const MessageSchema = new Schema(
    {
        // voice sessions: sessionId is set; text chat: agentId is set directly
        sessionId: { type: Schema.Types.ObjectId, ref: 'Session', index: true },
        agentId:   { type: Schema.Types.ObjectId, ref: 'Agent',   index: true },
        /** 'voice' = LiveKit realtime session, 'text' = REST chat endpoint */
        channel: { type: String, enum: ['voice', 'text'], default: 'voice' },
        role: { type: String, enum: ['user', 'assistant', 'tool', 'system'], required: true },
        text: { type: String },
        // tool calls, retrieved citations, screen actions, etc.
        meta: { type: Schema.Types.Mixed },
        at: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

MessageSchema.index({ text: 'text' });

export const Message = model('Message', MessageSchema);
