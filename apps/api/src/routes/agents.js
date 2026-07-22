import { Router } from 'express';
import { validate } from '@repo/validation';
import { AgentConfigInput, AgentUpdateInput } from '@repo/contracts';
import { Agent, ShareLink, Product, Message, Session } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { shareToken } from '@repo/utils';
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from '@repo/utils';
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

        // Phase 8 Task 3.6: AuditLog
        const product = await Product.findById(agent.productId).lean();
        if (product) {
            const { ip, userAgent } = extractRequestMeta(req);
            await logAudit({
                action: AUDIT_ACTIONS.AGENT_ACTIVATED,
                workspaceId: product.workspaceId,
                actorId: req.user.sub,
                target: { type: 'Agent', id: String(agent._id) },
                after: { status: 'active', shareToken: link.token },
                ip,
                userAgent
            });
        }

        res.json({ agentId: String(agent._id), token: link.token, url: `${base}/v/${link.token}` });
    } catch (err) {
        next(err);
    }
});

/** Get a specific agent configuration. */
agentsRouter.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        res.json({ ...agent.toObject(), shareUrl });
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /agents/:id
 * Update agent configuration (persona, tone, goals, avatar, screenModes, toolAccess).
 * productId cannot be changed after creation.
 */
agentsRouter.patch('/:id', requireAuth, validate({ body: AgentUpdateInput }), async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        // Build update object — only include provided fields
        const update = {};
        if (req.body.name !== undefined) update.name = req.body.name;
        if (req.body.avatarProvider !== undefined) update.avatarProvider = req.body.avatarProvider;
        if (req.body.screenModes !== undefined) update.screenModes = req.body.screenModes;

        // Merge persona fields individually to avoid overwriting unset keys
        if (req.body.persona) {
            const p = req.body.persona;
            if (p.tone !== undefined) update['persona.tone'] = p.tone;
            if (p.language !== undefined) update['persona.language'] = p.language;
            if (p.goals !== undefined) update['persona.goals'] = p.goals;
            if (p.guardrails !== undefined) update['persona.guardrails'] = p.guardrails;
        }

        // Merge toolAccess fields individually
        if (req.body.toolAccess) {
            const ta = req.body.toolAccess;
            if (ta.enabled !== undefined) update['toolAccess.enabled'] = ta.enabled;
            if (ta.baseUrl !== undefined) update['toolAccess.baseUrl'] = ta.baseUrl;
            if (ta.openApiUrl !== undefined) update['toolAccess.openApiUrl'] = ta.openApiUrl;
            if (ta.mcpUrl !== undefined) update['toolAccess.mcpUrl'] = ta.mcpUrl;
        }

        const updated = await Agent.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
        res.json(updated);
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /agents/:id
 * Cascade-deletes the agent and all its share links.
 * Returns 409 if any live session is currently running for this agent.
 */
agentsRouter.delete('/:id', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        // Guard: do not delete while a live session is running
        const liveSession = await Session.findOne({ agentId: agent._id, status: 'live' });
        if (liveSession) {
            return res.status(409).json({ error: 'Agent has an active live session. End it before deleting.' });
        }

        await ShareLink.deleteMany({ agentId: agent._id });
        await Agent.deleteOne({ _id: agent._id });

        // Phase 8 Task 3.6: AuditLog
        const product = await Product.findById(agent.productId).lean();
        if (product) {
            const { ip, userAgent } = extractRequestMeta(req);
            await logAudit({
                action: AUDIT_ACTIONS.AGENT_DELETED,
                workspaceId: product.workspaceId,
                actorId: req.user.sub,
                target: { type: 'Agent', id: String(agent._id) },
                before: { name: agent.name, status: agent.status },
                ip,
                userAgent
            });
        }

        res.json({ ok: true, agentId: String(agent._id) });
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
