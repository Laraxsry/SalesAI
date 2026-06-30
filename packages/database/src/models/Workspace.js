import { Schema, model } from 'mongoose';

const WorkspaceSchema = new Schema(
    {
        name: { type: String, required: true },
        slug: { type: String, required: true, unique: true, index: true },
        ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true }
    },
    { timestamps: true }
);

export const Workspace = model('Workspace', WorkspaceSchema);
