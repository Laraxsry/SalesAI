import { Router } from 'express';
import { validate } from '@repo/validation';
import { KnowledgeSourceInput } from '@repo/contracts';
import { KnowledgeSource } from '@repo/database';
import { enqueue, QUEUES } from '@repo/queue';
import { requireAuth } from '@repo/auth';

export const knowledgeRouter = Router();

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
