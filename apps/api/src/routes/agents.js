import { Router } from 'express';
import { validate } from '@repo/validation';
import { AgentConfigInput } from '@repo/contracts';
import { Agent, ShareLink, Product } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { shareToken } from '@repo/utils';

export const agentsRouter = Router();

/** Create / configure an agent for a product. */
agentsRouter.post('/', requireAuth, validate({ body: AgentConfigInput }), async (req, res, next) => {
    try {
        const product = await Product.findById(req.body.productId);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const agent = await Agent.create(req.body);
        res.status(201).json(agent);
    } catch (err) {
        next(err);
    }
});

/** Activate an agent -> produces a public share link. */
agentsRouter.post('/:id/activate', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findByIdAndUpdate(
            req.params.id,
            { status: 'active' },
            { new: true }
        );
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const link = await ShareLink.create({ agentId: agent._id, token: shareToken() });
        const base = process.env.VISITOR_PUBLIC_URL || 'http://localhost:5174';
        res.json({ agentId: String(agent._id), token: link.token, url: `${base}/v/${link.token}` });
    } catch (err) {
        next(err);
    }
});
