import { Schema, model } from 'mongoose';

/**
 * Visitor — lightweight identity for mobile app visitors (Mobile Phase 3).
 *
 * Deliberately not a `User`: no password, no workspace membership. Created
 * anonymously the first time a device registers for push (see Device.js);
 * `email` is attached later if the visitor requests a magic-link to sync
 * history across devices. `email` is sparse-unique so many anonymous
 * visitors (no email yet) can coexist.
 */
const VisitorSchema = new Schema(
    {
        email: { type: String, lowercase: true, trim: true }
    },
    { timestamps: true }
);

VisitorSchema.index({ email: 1 }, { unique: true, sparse: true });

export const Visitor = model('Visitor', VisitorSchema);
