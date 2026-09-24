import { Schema, model } from 'mongoose';

const MeetingSchema = new Schema({
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    attendeeParticipantIds: { type: [String], required: true },
    startsAt: { type: Date, required: true, index: true },
    timezone: { type: String, required: true },
    durationMinutes: { type: Number, required: true, min: 5, max: 480 },
    originalPhrase: { type: String, required: true },
    sourceEventId: { type: String, required: true },
    confirmationEventId: { type: String, required: true }
}, { timestamps: true });

MeetingSchema.index({ sessionId: 1, confirmationEventId: 1 }, { unique: true });

export const Meeting = model('Meeting', MeetingSchema);
