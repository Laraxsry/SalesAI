import { Schema, model } from 'mongoose';

const ShareLinkSchema = new Schema(
    {
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
        token: { type: String, required: true, unique: true, index: true },
        active: { type: Boolean, default: true },
        expiresAt: { type: Date },
        // optional access controls
        maxSessions: { type: Number },
        sessionCount: { type: Number, default: 0 }
    },
    { timestamps: true }
);

export const ShareLink = model('ShareLink', ShareLinkSchema);
