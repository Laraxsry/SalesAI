import { Schema, model } from 'mongoose';

const ProductSchema = new Schema(
    {
        workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
        name: { type: String, required: true },
        description: { type: String },
        websiteUrl: { type: String },
        // Sister/portfolio domains the seller explicitly trusts the guided
        // tour to navigate into, beyond websiteUrl's own registrable domain.
        // Only settable by the seller in the console — never derived from a
        // visitor conversation, since that's the trust boundary the SSRF
        // guard in @repo/screen relies on.
        tourAllowedDomains: [{ type: String }]
    },
    { timestamps: true }
);

export const Product = model('Product', ProductSchema);
