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
        sourceId: {
            type: Schema.Types.ObjectId,
            ref: 'KnowledgeSource',
            required: true,
            index: true
        },
        text: { type: String, required: true },
        // dense embedding (e.g. 3072 dims for text-embedding-3-large)
        embedding: { type: [Number], default: undefined },
        // modality + provenance for filtering and citation
        modality: { type: String, enum: ['text', 'image', 'video', 'web'], default: 'text' },
        metadata: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

export const KnowledgeChunk = model('KnowledgeChunk', KnowledgeChunkSchema);
