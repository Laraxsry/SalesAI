import { Router } from 'express';
import { validate } from '@repo/validation';
import { AgentConfigInput } from '@repo/contracts';
import { Agent, ShareLink, Product, Message } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { shareToken } from '@repo/utils';
import { retrieve } from '@repo/rag';
import { getLLM } from '@repo/ai';

export const agentsRouter = Router();

/** List all agents for a product. */
agentsRouter.get('/', requireAuth, async (req, res, next) => {
    try {
        const { productId } = req.query;
        if (!productId) {
            return res.status(400).json({ error: 'productId query param is required' });
        }
        const agents = await Agent.find({ productId }).sort({ createdAt: -1 });
        res.json(agents);
    } catch (err) {
        next(err);
    }
});

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
        let agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        if (agent.status === 'active') {
            return res.status(400).json({ error: 'Agent is already active' });
        }

        agent = await Agent.findByIdAndUpdate(
            req.params.id,
            { status: 'active' },
            { new: true }
        );

        const link = await ShareLink.create({ agentId: agent._id, token: shareToken() });
        const base = process.env.VISITOR_PUBLIC_URL || 'http://localhost:5174';
        res.json({ agentId: String(agent._id), token: link.token, url: `${base}/v/${link.token}` });
    } catch (err) {
        next(err);
    }
});

/** Get a specific agent configuration, including its active share link (if any). */
agentsRouter.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        let shareUrl;
        if (agent.status === 'active') {
            const link = await ShareLink.findOne({ agentId: agent._id, active: true }).sort({ createdAt: -1 });
            if (link) {
                const base = process.env.VISITOR_PUBLIC_URL || 'http://localhost:5174';
                shareUrl = `${base}/v/${link.token}`;
            }
        }

        res.json({ ...agent.toObject(), shareUrl });
    } catch (err) {
        next(err);
    }
});

/** Pause an agent -> status: paused. */
agentsRouter.post('/:id/pause', requireAuth, async (req, res, next) => {
    try {
        let agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        if (agent.status === 'paused') {
            return res.status(400).json({ error: 'Agent is already paused' });
        }

        agent = await Agent.findByIdAndUpdate(
            req.params.id,
            { status: 'paused' },
            { new: true }
        );
        res.json(agent);
    } catch (err) {
        next(err);
    }
});

/** List all agents, optionally filtered by productId. */
agentsRouter.get('/', requireAuth, async (req, res, next) => {
    try {
        const { productId } = req.query;
        const filter = productId ? { productId } : {};
        const agents = await Agent.find(filter).sort({ createdAt: -1 });
        res.json(agents);
    } catch (err) {
        next(err);
    }
});

/** List all sessions for an agent */
agentsRouter.get('/:id/sessions', requireAuth, async (req, res, next) => {
    try {
        const { Session } = await import('@repo/database');
        const sessions = await Session.find({ agentId: req.params.id }).sort({ createdAt: -1 });
        res.json(sessions);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /:id/chat
 * Grounded text chat endpoint (RAG).
 * 
 * Body: { messages: [{ role: 'user', content: 'What is this product?' }] }
 */
agentsRouter.post('/:id/chat', async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const messages = req.body.messages || [];
        if (!messages.length) return res.status(400).json({ error: 'messages array is required' });

        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        const query = lastUserMessage?.content || '';

        // 1. Bilgi arama (Retrieval)
        let citations = [];
        let contextText = '';
        if (query) {
            const chunks = await retrieve({ productId: String(agent.productId), query, topK: 5 });
            citations = chunks.map(c => ({ sourceId: c.sourceId, text: c.text, score: c.score }));
            contextText = chunks.map((c, i) => `[Citation ${i+1}]\n${c.text}`).join('\n\n');
        }

        // 2. Yapay Zekaya (LLM) Bağlamı ve Soruyu Gönderme
        const systemPrompt = `
You are ${agent.name}, an expert AI sales agent.
Your tone is: ${agent.persona?.tone || 'friendly, expert, concise'}.
Your goals: ${(agent.persona?.goals || []).join(', ')}.

Answer the user's questions strictly based on the following retrieved knowledge context.
If the answer is not in the context, politely say you don't know, but try to be helpful.
When using information from the context, use citations like [Citation 1].

=== KNOWLEDGE CONTEXT ===
${contextText || 'No specific context found.'}
=========================
        `.trim();

        const llm = getLLM();
        const response = await llm.complete({
            system: systemPrompt,
            messages: messages
        });

        // 3. Konuşma turlarını DB'ye kaydet (fire-and-forget, hata non-fatal)
        Message.insertMany([
            {
                agentId: agent._id,
                channel: 'text',
                role: 'user',
                text: query,
                at: new Date()
            },
            {
                agentId: agent._id,
                channel: 'text',
                role: 'assistant',
                text: response.text,
                meta: { citations },
                at: new Date()
            }
        ]).catch(err => console.warn('[agents] message persist failed:', err?.message));

        // 4. Yanıtı dön
        res.json({
            role: 'assistant',
            content: response.text,
            citations: citations
        });
    } catch (err) {
        next(err);
    }
});
