import { Schema, model } from 'mongoose';

const InvitationSchema = new Schema(
    {
        workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
        email: { type: String, required: true, lowercase: true, trim: true, index: true },
        role: { type: String, enum: ['ADMIN', 'EDITOR', 'VIEWER'], default: 'EDITOR' },
        token: { type: String, required: true, unique: true, index: true },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'expired', 'revoked'],
            default: 'pending',
            index: true
        },
        invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        expiresAt: { type: Date, required: true, index: true }
    },
    { timestamps: true }
);

InvitationSchema.index({ workspaceId: 1, email: 1, status: 1 });

export const Invitation = model('Invitation', InvitationSchema);
