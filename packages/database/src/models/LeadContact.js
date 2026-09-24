import { Schema, model } from 'mongoose';

const ConfirmationRefSchema = new Schema({
    sourceEventId: { type: String, required: true },
    confirmationEventId: { type: String, required: true },
    confirmedAt: { type: Date, required: true }
}, { _id: false });

const LeadContactSchema = new Schema({
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    participantId: { type: String, required: true, index: true },
    contact: {
        name: { type: String },
        email: { type: String },
        phone: { type: String },
        company: { type: String }
    },
    confirmationRefs: {
        name: { type: ConfirmationRefSchema },
        email: { type: ConfirmationRefSchema },
        phone: { type: ConfirmationRefSchema },
        company: { type: ConfirmationRefSchema }
    }
}, { timestamps: true });

LeadContactSchema.index({ sessionId: 1, participantId: 1 }, { unique: true });

export const LeadContact = model('LeadContact', LeadContactSchema);
