import { Schema, model } from 'mongoose';

/**
 * One knowledge-audit run over a product's chunks: what the reviewer LLM
 * found, and what the operator decided to do about it.
 *
 * Findings are stored as *proposals*, not as applied changes. Nothing touches
 * the vector store until a finding is approved and applied — an LLM deciding
 * on its own that a chunk is unnecessary would silently take away the agent's
 * ability to answer something, and nobody would notice: the agent would just
 * start saying it doesn't know.
 */
const KnowledgeAuditFindingSchema = new Schema(
    {
        /** Stable per-run identifier the console uses to approve/reject a single finding. */
        key: { type: String, required: true },
        type: { type: String, enum: ['duplicate', 'contradiction', 'junk'], required: true },
        /** One-line statement of what is wrong, in the operator's language. */
        summary: { type: String, required: true },
        /** Why the reviewer thinks so — shown next to the evidence in the console. */
        rationale: { type: String, default: '' },
        /** Every chunk involved, including the one being kept. */
        chunkIds: { type: [Schema.Types.ObjectId], default: [] },
        /** For duplicates: the chunk to keep as-is when no rewrite is proposed. */
        keepChunkId: { type: Schema.Types.ObjectId },
        /** The replacement text, when the reviewer proposes merging/resolving. */
        canonicalText: { type: String },
        audience: { type: String, enum: ['general', 'technical'], default: 'general' },
        /** Highest pairwise similarity in the cluster — how the finding was surfaced. */
        similarity: { type: Number },
        decision: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'applied', 'failed'],
            default: 'pending'
        },
        error: { type: String }
    },
    { _id: false }
);

const KnowledgeAuditSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
        status: {
            type: String,
            enum: ['queued', 'running', 'ready', 'applied', 'failed'],
            default: 'queued',
            index: true
        },
        findings: { type: [KnowledgeAuditFindingSchema], default: [] },
        /** Run-level counters: chunks scanned, clusters reviewed, LLM calls, truncation. */
        stats: { type: Schema.Types.Mixed, default: {} },
        error: { type: String },
        startedAt: { type: Date },
        finishedAt: { type: Date },
        appliedAt: { type: Date }
    },
    { timestamps: true }
);

export const KnowledgeAudit = model('KnowledgeAudit', KnowledgeAuditSchema);
