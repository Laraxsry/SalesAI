import { Schema, model } from 'mongoose';

const WorkspaceSchema = new Schema(
    {
        name: { type: String, required: true },
        slug: { type: String, required: true, unique: true, index: true },
        ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        // Phase 8: Data Retention
        // Session, Message, SessionEvent, SessionSummary kaçıncı günden sonra purge edilsin?
        // Varsayılan 365 gün. GDPR madde 5(1)(e) — "storage limitation" ilkesi.
        retentionDays: { type: Number, default: 365, min: 1 }
    },
    { timestamps: true }
);

export const Workspace = model('Workspace', WorkspaceSchema);

