import { Schema, model } from 'mongoose';

const UsageRecordSchema = new Schema(
    {
        workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
        meter: {
            type: String,
            enum: ['agent_voice_minutes', 'avatar_seconds', 'ingestion_units', 'tour_browser_minutes', 'vision_frames'],
            required: true,
            index: true
        },
        quantity: { type: Number, required: true },
        estCost: { type: Number, default: 0 },
        sessionId: { type: Schema.Types.ObjectId, ref: 'Session', default: null },
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
        timestamp: { type: Date, default: Date.now, index: true }
    },
    { timestamps: true }
);

UsageRecordSchema.index({ workspaceId: 1, meter: 1, timestamp: -1 });

export const UsageRecord = model('UsageRecord', UsageRecordSchema);
