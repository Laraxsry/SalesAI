import { Schema, model } from 'mongoose';
import crypto from 'crypto';

/** Generates a short, URL-safe random ID for webhook entries in the subdocument array. */
function webhookId() {
    return crypto.randomBytes(8).toString('hex');
}

const WebhookSchema = new Schema(
    {
        _id:    { type: String, default: webhookId },
        url:    { type: String, required: true },
        /** HMAC-SHA256 signing secret. Stored in plaintext (workspace-scoped). */
        secret: { type: String, default: () => crypto.randomBytes(24).toString('hex') },
        /** Which event types trigger this webhook. Empty = all events. */
        events: { type: [String], default: [] },
        active: { type: Boolean, default: true }
    },
    { _id: false }
);

const WorkspaceSchema = new Schema(
    {
        name: { type: String, required: true },
        slug: { type: String, required: true, unique: true, index: true },
        ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        // Phase 8: Data Retention
        // Session, Message, SessionEvent, SessionSummary kaçıncı günden sonra purge edilsin?
        // Varsayılan 365 gün. GDPR madde 5(1)(e) — "storage limitation" ilkesi.
        retentionDays: { type: Number, default: 365, min: 1 },
        /** Phase 4: Outbound webhook endpoints for CRM/Zapier/Slack integration. */
        webhooks: { type: [WebhookSchema], default: [] }
    },
    { timestamps: true }
);

export const Workspace = model('Workspace', WorkspaceSchema);

