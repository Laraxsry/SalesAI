import { Schema, model } from 'mongoose';

/**
 * A retrievable chunk of product knowledge.
 * `embedding` holds the dense vector; an Atlas Vector Search index named
 * "vector_index" must be created on this field (see scripts/sync-indexes.js).
 * When VECTOR_STORE=qdrant, the vector lives in Qdrant and this field may be empty.
 */
const KnowledgeChunkSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
        // Exactly one of sourceId/topicId is set, enforced below (not via
        // mongoose `required`, which can't express "either/or") — a chunk
        // either belongs to one crawl input (sourceId, the original model)
        // or to a cross-source KnowledgeTopic document (topicId, see
        // KnowledgeTopic.js). Kept as two fields rather than a shared
        // polymorphic ref so deleteBySource()/deleteByTopic() stay simple,
        // targeted queries instead of a discriminator lookup.
        sourceId: {
            type: Schema.Types.ObjectId,
            ref: 'KnowledgeSource',
            index: true
        },
        topicId: {
            type: Schema.Types.ObjectId,
            ref: 'KnowledgeTopic',
            index: true
        },
        text: { type: String, required: true },
        // dense embedding (e.g. 3072 dims for text-embedding-3-large)
        embedding: { type: [Number], default: undefined },
        // modality + provenance for filtering and citation
        modality: { type: String, enum: ['text', 'image', 'video', 'web'], default: 'text' },
        // auto-classified during ingestion; used to bias retrieval toward the visitor's depth preference
        audience: { type: String, enum: ['general', 'technical'], default: 'general', index: true },
        // Knowledge audit (curation layer). Only 'active' chunks are retrievable.
        // A curated chunk replacing a duplicate/contradictory group is written as
        // a new chunk; the originals become 'superseded' rather than being
        // deleted, so an audit is always reversible and the raw ingestion output
        // stays the single source of truth on disk.
        status: {
            type: String,
            enum: ['active', 'superseded', 'excluded'],
            default: 'active',
            index: true
        },
        // the curated chunk that replaced this one (set on 'superseded' chunks)
        supersededBy: { type: Schema.Types.ObjectId, ref: 'KnowledgeChunk' },
        // the chunks a curated chunk was distilled from (provenance, for the UI)
        curatedFrom: { type: [Schema.Types.ObjectId], default: undefined },
        metadata: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

// No `next` callback param on purpose: Mongoose 9's insertMany() validates
// documents in parallel (parallelLimit), and a callback-style pre('validate')
// hook is unreliable there — Kareem intermittently invokes it without a
// working `next`, throwing "next is not a function" (seen consistently on
// KnowledgeTopic document inserts). A plain sync function that throws avoids
// Kareem's callback wiring entirely and works the same for save() and
// insertMany() alike.
KnowledgeChunkSchema.pre('validate', function enforceSourceOrTopic() {
    if (!this.sourceId && !this.topicId) {
        throw new Error('KnowledgeChunk requires either sourceId or topicId');
    }
});

export const KnowledgeChunk = model('KnowledgeChunk', KnowledgeChunkSchema);
