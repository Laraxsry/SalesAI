import { Schema, model } from 'mongoose';

/**
 * Origin allowlist entry for the embeddable widget (Phase 5).
 *
 * `domain` is a hostname pattern, optionally wildcarded: `acme.com` matches
 * exactly, `*.acme.com` matches any subdomain (but not the apex). Patterns are
 * stored lowercase; validation and matching live in @repo/contracts
 * (`isValidEmbedDomainPattern` / `matchesEmbedDomain`) so the API boundary and
 * the runtime origin check can never drift apart.
 *
 * `verified` is reserved for domain-ownership verification (DNS TXT / meta
 * tag); entries default to unverified and the flag is preserved when a config
 * update keeps an existing domain.
 */
const EmbedDomainSchema = new Schema(
    {
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
        domain: { type: String, required: true, lowercase: true, trim: true },
        verified: { type: Boolean, default: false },
        verifiedAt: { type: Date }
    },
    { timestamps: true }
);

EmbedDomainSchema.index({ agentId: 1, domain: 1 }, { unique: true });

export const EmbedDomain = model('EmbedDomain', EmbedDomainSchema);
