import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeSource, Product, Membership } from '@repo/database';
import { enqueueIngestion } from '../lib/ingestion.js';
import { knowledgeRouter } from './knowledge.js';

vi.mock('../lib/ingestion.js', () => ({ enqueueIngestion: vi.fn() }));

const handler = knowledgeRouter.stack.find((layer) => layer.route?.path === '/:id/retry').route.stack.at(-1).handle;
const source = { _id: 'source-1', productId: 'product-1', type: 'url', status: 'failed' };

async function request() {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await handler({ params: { id: source._id }, user: { sub: 'user-1' } }, res, next);
    return { res, next };
}

describe('knowledge crawl retry', () => {
    beforeEach(() => {
        vi.mocked(enqueueIngestion).mockReset().mockResolvedValue(undefined);
        vi.spyOn(KnowledgeSource, 'findById').mockResolvedValue(source);
        vi.spyOn(Product, 'findById').mockReturnValue({ select: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1' }) });
        vi.spyOn(Membership, 'findOne').mockResolvedValue({ role: 'owner' });
        vi.spyOn(KnowledgeSource, 'findOneAndUpdate').mockResolvedValue(source);
        vi.spyOn(KnowledgeSource, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    });
    afterEach(() => vi.restoreAllMocks());

    it('queues the existing source with an atomic failed-status guard', async () => {
        const { res, next } = await request();
        expect(KnowledgeSource.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: source._id, status: 'failed' },
            {
                $set: {
                    status: 'pending',
                    'meta.ingestionProgress': {
                        stage: 'Kuyruğa alındı',
                        pct: 0,
                        updatedAt: expect.any(Date)
                    }
                },
                $unset: { error: '' }
            },
            { new: true }
        );
        expect(enqueueIngestion).toHaveBeenCalledWith(source._id, source.productId, { type: 'url' });
        expect(res.json).toHaveBeenCalledWith({ ok: true, status: 'pending' });
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects users outside the workspace without changing or queueing the source', async () => {
        Membership.findOne.mockResolvedValue(null);
        const { res } = await request();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(KnowledgeSource.findOneAndUpdate).not.toHaveBeenCalled();
        expect(enqueueIngestion).not.toHaveBeenCalled();
    });

    it('does not enqueue a duplicate when the source is already pending', async () => {
        KnowledgeSource.findOneAndUpdate.mockResolvedValue(null);
        const { res } = await request();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(enqueueIngestion).not.toHaveBeenCalled();
    });

    it('restores failed status when queueing fails so the user can retry again', async () => {
        const error = new Error('Queue unavailable');
        vi.mocked(enqueueIngestion).mockRejectedValue(error);
        const { next } = await request();
        expect(KnowledgeSource.updateOne).toHaveBeenCalledWith(
            { _id: source._id, status: 'pending' },
            { $set: { status: 'failed', error: error.message } }
        );
        expect(next).toHaveBeenCalledWith(error);
    });
});
