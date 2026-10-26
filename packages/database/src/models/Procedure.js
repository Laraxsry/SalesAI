import { Schema, model } from 'mongoose';

/**
 * Procedure — one flow on a product's own dashboard, learned by actually doing it on a demo account
 * (apps/worker-ingestion's learning run): which page, which button opens the form, what the form
 * asks for, what the page does when it is saved, and how to undo it.
 *
 * Two representations of the same thing, on purpose:
 *  - the structured fields here (`steps`, `form`, `expect`, `undo`) are what a demo executes, step by step;
 *  - `description` + the chunk(s) in `chunkIds` are what retrieval finds when a visitor's conversation
 *    touches the subject (the chunks live on the dashboard shelf, `KnowledgeChunk.kind = 'ui'`).
 *
 * `status` becomes 'stale' when the dashboard changes under it, so an outdated recipe is never run.
 */
const ProcedureSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
        // The logged-in panel source whose shelf the procedure's chunks are filed on.
        sourceId: { type: Schema.Types.ObjectId, ref: 'KnowledgeSource', required: true },
        // Stable per product: page + button, e.g. 'cms-variable--new-variable'.
        slug: { type: String, required: true },
        title: { type: String, required: true },
        kind: { type: String, enum: ['create'], default: 'create' },
        language: { type: String, default: 'en' },
        pageUrl: { type: String, required: true },
        trigger: { type: String, required: true },
        form: { type: Schema.Types.Mixed },
        steps: { type: Schema.Types.Mixed },
        expect: { type: Schema.Types.Mixed },
        undo: { type: Schema.Types.Mixed },
        safety: { type: Schema.Types.Mixed },
        // A short plain-language account of what the flow is for.
        description: { type: String, default: '' },
        descriptionSource: { type: String, enum: ['template', 'llm'], default: 'template' },
        chunkIds: { type: [Schema.Types.ObjectId], default: [] },
        status: { type: String, enum: ['active', 'stale'], default: 'active', index: true },
        version: { type: Number, default: 1 },
        learnedAt: { type: Date },
        verifiedAt: { type: Date }
    },
    { timestamps: true }
);

ProcedureSchema.index({ productId: 1, slug: 1 }, { unique: true });

export const Procedure = model('Procedure', ProcedureSchema);
