import { Schema, model } from 'mongoose';

const SessionSchema = new Schema(
    {
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
        shareLinkId: { type: Schema.Types.ObjectId, ref: 'ShareLink', index: true },
        roomName: { type: String, required: true, index: true },
        visitorName: { type: String },
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
        // rolled-up analytics (durations, topics, sentiment)
        summary: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

export const Session = model('Session', SessionSchema);
