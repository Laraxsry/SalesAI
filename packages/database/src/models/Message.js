import { Schema, model } from 'mongoose';

const MessageSchema = new Schema(
    {
        sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
        role: { type: String, enum: ['user', 'assistant', 'tool', 'system'], required: true },
        text: { type: String },
        // tool calls, retrieved citations, screen actions, etc.
        meta: { type: Schema.Types.Mixed },
        at: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

export const Message = model('Message', MessageSchema);
