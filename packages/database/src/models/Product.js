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
        tourAllowedDomains: [{ type: String }],

        // Per-product browser backend override. Falls back to the
        // COBROWSE_PROVIDER env default when unset, so a chrome-mcp rollout
        // can cover well-behaved products while exotic/low-a11y demo logins
        // stay on the Playwright driver — see selectBrowserProvider().
        browserProvider: { type: String, enum: ['playwright', 'stagehand', 'browserbase', 'chrome-mcp'] },

        // Phase 3: Single demo session injected into the agent's browser
        // Always encrypted before saving to DB.
        demoSession: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

export const Product = model('Product', ProductSchema);
