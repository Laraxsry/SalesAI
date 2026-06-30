import { Schema, model } from 'mongoose';

const MembershipSchema = new Schema(
    {
        workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        role: { type: String, enum: ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'], default: 'VIEWER' }
    },
    { timestamps: true }
);

MembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const Membership = model('Membership', MembershipSchema);
