import { Schema, model } from 'mongoose';

/**
 * MagicLinkToken — single-use, short-lived token for passwordless visitor
 * auth (Mobile Phase 3: "optional email magic-link to sync history").
 *
 * Mirrors Invitation's token pattern (random hex, status via consumedAt)
 * rather than a signed JWT, so a token can be revoked/inspected server-side
 * before it's ever exchanged for a real session.
 */
const MagicLinkTokenSchema = new Schema(
    {
        email: { type: String, required: true, lowercase: true, trim: true, index: true },
        token: { type: String, required: true, unique: true, index: true },
        visitorId: { type: Schema.Types.ObjectId, ref: 'Visitor', required: true },
        expiresAt: { type: Date, required: true },
        consumedAt: { type: Date }
    },
    { timestamps: true }
);

export const MagicLinkToken = model('MagicLinkToken', MagicLinkTokenSchema);
