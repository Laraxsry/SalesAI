import { Schema, model } from 'mongoose';

const KnowledgeSourceSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
        type: {
            type: String,
            enum: ['text', 'document', 'image', 'video', 'url', 'api'],
            required: true
        },
        title: { type: String },
        // raw text (type=text), storage key (document/image/video), or url (url/api)
        content: { type: String },
        fileKey: { type: String },
        url: { type: String },
        status: {
            type: String,
            enum: ['pending', 'processing', 'ready', 'failed'],
            default: 'pending',
            index: true
        },
        error: { type: String },
        // ingestion artifacts (e.g. transcript, ocr text, crawl summary)
        meta: { type: Schema.Types.Mixed }
    },
    { timestamps: true }
);

export const KnowledgeSource = model('KnowledgeSource', KnowledgeSourceSchema);
