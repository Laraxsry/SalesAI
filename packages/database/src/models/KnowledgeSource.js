import { Schema, model } from 'mongoose';

const KnowledgeSourceSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
        type: {
            type: String,
            // 'curated' is not uploaded by anyone — it is the synthetic source
            // that owns the chunks a knowledge audit wrote (see @repo/rag audit).
            enum: ['text', 'document', 'image', 'video', 'url', 'api', 'curated'],
            required: true
        },
        title: { type: String },
        // raw text (type=text), storage key (document/image/video), or url (url/api)
        content: { type: String },
        fileKey: { type: String },
        mimeType: { type: String }, // e.g. 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        url: { type: String },
        status: {
            type: String,
            enum: ['pending', 'processing', 'ready', 'failed', 'disabled'],
            default: 'pending',
            index: true
        },
        error: { type: String },
        // set on zip/archive children; points at the container KnowledgeSource
        parentSourceId: { type: Schema.Types.ObjectId, ref: 'KnowledgeSource', index: true },
        // ingestion artifacts (e.g. transcript, ocr text, crawl summary)
        meta: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

export const KnowledgeSource = model('KnowledgeSource', KnowledgeSourceSchema);
