import { Schema, model } from 'mongoose';

const ProductSchema = new Schema(
    {
        workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
        name: { type: String, required: true },
        description: { type: String },
        websiteUrl: { type: String }
    },
    { timestamps: true }
);

export const Product = model('Product', ProductSchema);
