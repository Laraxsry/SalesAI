import { Router } from 'express';
import { validate } from '@repo/validation';
import { KnowledgeSourceInput } from '@repo/contracts';
import { KnowledgeSource } from '@repo/database';
import { enqueue, QUEUES } from '@repo/queue';
import { requireAuth } from '@repo/auth';
import { presignUpload } from '@repo/storage';
import { shortId } from '@repo/utils';

export const knowledgeRouter = Router();

/**
 * POST /knowledge/upload-url
 *
 * İstemcinin MinIO/S3'ye doğrudan dosya yükleyebilmesi için
 * geçici bir yükleme linki (presigned URL) oluşturur.
 *
 * Body: { "filename": "rapor.pdf", "contentType": "application/pdf" }
 */
knowledgeRouter.post('/upload-url', requireAuth, async (req, res, next) => {
    try {
        const { filename, contentType } = req.body;
        if (!filename || !contentType) {
            return res.status(400).json({ error: 'filename and contentType are required' });
        }

        // Benzersiz bir dosya anahtarı oluştur (örneğin: uploads/user123/rapor-abc123.pdf)
        const ext = filename.split('.').pop();
        const fileKey = `uploads/${req.user.sub}/${shortId(8)}.${ext}`;

        // 15 dakikalık yükleme linki oluştur
        const url = await presignUpload(fileKey, contentType, 900);

        res.json({ url, fileKey });
    } catch (err) {
        next(err);
    }
});

/**
 * Seller adds a knowledge source (text/document/image/video/url/api).
 * We persist it and enqueue an ingestion job; the worker extracts text,
 * embeds it, and marks the source ready.
 */
knowledgeRouter.post(
    '/',
    requireAuth,
    validate({ body: KnowledgeSourceInput }),
    async (req, res, next) => {
        try {
            const source = await KnowledgeSource.create({ ...req.body, status: 'pending' });
            await enqueue(QUEUES.INGESTION, 'ingest-source', {
                sourceId: String(source._id),
                productId: req.body.productId,
                type: req.body.type
            });
            res.status(201).json({ id: String(source._id), status: source.status });
        } catch (err) {
            next(err);
        }
    }
);

knowledgeRouter.get('/:productId', requireAuth, async (req, res, next) => {
    try {
        const sources = await KnowledgeSource.find({ productId: req.params.productId }).sort({
            createdAt: -1
        });
        res.json(sources);
    } catch (err) {
        next(err);
    }
});
