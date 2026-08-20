import { Router } from 'express';
import { validate } from '@repo/validation';
import {
    AgentConfigInput,
    AgentUpdateInput,
    EmbedConfigInput,
    PlaybookInput,
    normalizePlaybook,
    isTourNavigableUrl
} from '@repo/contracts';
import { Agent, ShareLink, Product, Message, Session, EmbedConfig, EmbedDomain, Playbook } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { shareToken, buildEmbedSnippet, logAudit, extractRequestMeta, AUDIT_ACTIONS } from '@repo/utils';
import { retrieve } from '@repo/rag';
import { getLLM } from '@repo/ai';
import { getSdkVersion } from '../services/sdk-bundle.js';
import { requestTimeout } from '../middleware/request-timeout.js';
import { chatRateLimit } from '../middleware/public-rate-limits.js';
import { reingestAutoUrlSource } from './products.js';

export const agentsRouter = Router();

/**
 * Whether `agentId` is the earliest-created Agent for `productId` — i.e.
 * the one `resolveKnowledgeLanguage()`
 * (`apps/worker-ingestion/src/handlers/ingest-source.js`) actually reads
 * `persona.language` from when synthesizing URL-crawl content. Creating or
 * relabeling a later agent doesn't change what the knowledge base
 * synthesizes in, so callers only need to trigger a re-ingest when this is
 * true.
 */
async function isEarliestAgentForProduct(agentId, productId) {
    const earliest = await Agent.findOne({ productId }).sort({ createdAt: 1 }).select('_id');
    return String(earliest?._id) === String(agentId);
}

/**
 * Infers whether the visitor wants surface-level or technical-depth answers,
 * from the *entire* conversation so far (not just the last message) — this
 * makes the preference "sticky" once the visitor asks for technical depth,
 * without needing any server-side session state (the client already resends
 * full history on every request). Cheap model, non-fatal on failure.
 * @param {Array<{role:string, content:string}>} messages
 * @returns {Promise<'general'|'technical'>}
 */
async function classifyAudiencePreference(messages) {
    const userText = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join('\n');
    if (!userText.trim()) return 'general';

    try {
        const llm = getLLM();
        const response = await llm.complete({
            model: 'gpt-4o-mini',
            system: `Decide the depth level a sales assistant should answer at, based on the visitor's messages so far.
Respond ONLY with valid JSON (no markdown): {"audience": "general"|"technical"}
- "technical": the visitor asked for implementation/API/architecture detail, used technical terminology, or explicitly asked to go deeper/more technical.
- "general": everything else (default).
Once the visitor has shown technical interest at any point in the conversation, keep answering "technical".`,
            messages: [{ role: 'user', content: userText }]
        });
        const parsed = JSON.parse(response.text);
        return parsed.audience === 'technical' ? 'technical' : 'general';
    } catch {
        return 'general';
    }
}

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

        // A brand-new product's URL crawl (triggered synchronously at
        // product creation, before any Agent exists) always synthesized in
        // the 'en' fallback — this is the first point a real language
        // becomes known, so the first agent for a product re-triggers that
        // synthesis in the right language. Later agents don't change what
        // resolveKnowledgeLanguage() resolves (it always reads the
        // earliest-created agent), so this only fires once per product.
        const isFirstAgent = (await Agent.countDocuments({ productId: req.body.productId })) === 0;

        const agent = await Agent.create(req.body);

        if (isFirstAgent) {
            reingestAutoUrlSource(req.body.productId).catch((err) =>
                console.warn('[agents] reingestAutoUrlSource (first agent) failed:', err.message)
            );
        }

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

        // Rotate: every (re)activation deactivates this agent's previous share
        // links so a leaked/old link stops working once the agent is
        // reactivated, instead of silently staying valid forever alongside
        // the new one (agent.status alone only gates *new* sessions while
        // paused — it never invalidated the link itself).
        await ShareLink.updateMany({ agentId: agent._id, active: true }, { active: false });

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

        // Aktif agent için mevcut ShareLink'i bul ve shareUrl hesapla
        let shareUrl = null;
        if (agent.status === 'active') {
            const link = await ShareLink.findOne({ agentId: agent._id }).sort({ createdAt: -1 });
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

        const languageChanged =
            req.body.persona?.language !== undefined && req.body.persona.language !== agent.persona?.language;

        const updated = await Agent.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });

        // Only the earliest-created agent's language feeds
        // resolveKnowledgeLanguage() — relabeling any other agent's
        // language doesn't change what the URL crawl synthesizes in.
        if (languageChanged && (await isEarliestAgentForProduct(agent._id, agent.productId))) {
            reingestAutoUrlSource(agent.productId).catch((err) =>
                console.warn('[agents] reingestAutoUrlSource (language change) failed:', err.message)
            );
        }

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

/**
 * Phase 5: Read the agent's current embed (widget) configuration + domain
 * allowlist, for prefilling the Embed Studio UI. Defaults are returned when
 * no EmbedConfig has been saved yet (schema defaults, no domains).
 *
 * md/backend/phase5: GET /api/v1/agents/:id/embed
 */
agentsRouter.get('/:id/embed', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const [embedConfig, allowlist, link] = await Promise.all([
            EmbedConfig.findOne({ agentId: agent._id }),
            EmbedDomain.find({ agentId: agent._id }).sort({ domain: 1 }).lean(),
            ShareLink.findOne({ agentId: agent._id, active: true }).sort({ createdAt: -1 })
        ]);

        const config = (embedConfig || new EmbedConfig({ agentId: agent._id })).toObject();
        const snippet = link
            ? buildEmbedSnippet({
                  apiBaseUrl: process.env.API_PUBLIC_URL || 'http://localhost:5001',
                  shareToken: link.token,
                  sdkVersion: getSdkVersion()
              })
            : null;

        res.json({ ...config, domains: allowlist, snippet });
    } catch (err) {
        next(err);
    }
});

/**
 * Phase 5: Save the agent's embed (widget) configuration + domain allowlist.
 *
 * Upsert semantics: one EmbedConfig per agent; the domain list in the body is
 * the new complete allowlist. Domains kept across updates preserve their
 * `verified` state; removed ones are deleted, new ones start unverified.
 *
 * Requires the agent to already have an active ShareLink: per the chosen
 * design, the widget and the mailed link share one token (Decision: shared
 * ShareLink token, not a separate embed token), so there is nothing to embed
 * until `POST /:id/activate` has minted that token.
 *
 * md/backend/phase5: POST /api/v1/agents/:id/embed
 */
agentsRouter.post('/:id/embed', requireAuth, validate({ body: EmbedConfigInput }), async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const link = await ShareLink.findOne({ agentId: agent._id, active: true }).sort({ createdAt: -1 });
        if (!link) {
            return res.status(409).json({ error: 'Activate the agent first — embedding reuses its share token' });
        }

        const { domains, ...config } = req.body;

        const embedConfig = await EmbedConfig.findOneAndUpdate(
            { agentId: agent._id },
            { $set: config },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        // Sync the allowlist: body is authoritative, verification survives.
        await EmbedDomain.deleteMany({ agentId: agent._id, domain: { $nin: domains } });
        const existing = new Set(
            (await EmbedDomain.find({ agentId: agent._id }, 'domain').lean()).map((d) => d.domain)
        );
        const toInsert = domains.filter((d) => !existing.has(d)).map((domain) => ({ agentId: agent._id, domain }));
        if (toInsert.length) await EmbedDomain.insertMany(toInsert);

        const allowlist = await EmbedDomain.find({ agentId: agent._id }).sort({ domain: 1 }).lean();
        const snippet = buildEmbedSnippet({
            apiBaseUrl: process.env.API_PUBLIC_URL || 'http://localhost:5001',
            shareToken: link.token,
            sdkVersion: getSdkVersion()
        });
        res.json({ ...embedConfig.toObject(), domains: allowlist, snippet });
    } catch (err) {
        next(err);
    }
});

/**
 * The agent's presentation route — see md/backend/agent_flow.md. One
 * Playbook per agent; GET returns schema defaults (200, not 404) when none
 * has been saved yet, same convention as GET /:id/embed, so the editor can
 * always render a blank list to start from. Also returns the product's
 * `websiteUrl`/`tourAllowedDomains` so the console can validate a step's URL
 * against the exact same trust root the server will re-check on save,
 * without a second request.
 */
agentsRouter.get('/:id/playbook', requireAuth, async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const [doc, product] = await Promise.all([
            Playbook.findOne({ agentId: agent._id }),
            Product.findById(agent.productId)
        ]);

        const playbook = (doc || new Playbook({ agentId: agent._id })).toObject();
        res.json({
            ...playbook,
            product: {
                websiteUrl: product?.websiteUrl || null,
                tourAllowedDomains: product?.tourAllowedDomains || []
            }
        });
    } catch (err) {
        next(err);
    }
});

/**
 * Save the agent's playbook. Upsert semantics: the body's `nodes` is the new
 * complete route, normalized (sorted, densely renumbered, blank steps
 * dropped — see normalizePlaybook) before it's stored. Every step's `url` is
 * re-checked against the product's trust root server-side — never trust the
 * client-side check alone, since the allowlist can change after a playbook
 * was written. `version` is bumped on every save so a session's transcript
 * can record exactly which revision it ran against.
 */
agentsRouter.post('/:id/playbook', requireAuth, validate({ body: PlaybookInput }), async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const product = await Product.findById(agent.productId);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const nodes = normalizePlaybook(req.body.nodes);
        const badIndex = nodes.findIndex((n) => n.url && !isTourNavigableUrl(n.url, product));
        if (badIndex !== -1) {
            return res.status(422).json({
                error: `Step ${badIndex + 1}: URL is outside the product's allowed domains`,
                index: badIndex
            });
        }

        // $inc against a field that also carries a schema `default` can be
        // rejected by Mongoose on the insert branch of an upsert, so the new
        // version number is computed explicitly instead (read-then-write;
        // playbook saves are an infrequent, editor-driven operation, not a
        // hot path where the extra round trip matters).
        const existing = await Playbook.findOne({ agentId: agent._id }, 'version').lean();
        const doc = await Playbook.findOneAndUpdate(
            { agentId: agent._id },
            { $set: { nodes, enabled: req.body.enabled !== false, version: (existing?.version || 0) + 1 } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.json({
            ...doc.toObject(),
            product: {
                websiteUrl: product.websiteUrl || null,
                tourAllowedDomains: product.tourAllowedDomains || []
            }
        });
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
        const { Session, Lead } = await import('@repo/database');
        const sessions = await Session.find({ agentId: req.params.id }).sort({ createdAt: -1 });

        // Fallback identity source for sessions that ended before the live
        // confirmedContact tool existed (or the visitor never confirmed
        // anything mid-call) — extract-lead's post-call regex parse still
        // found something. Sessions UI prefers confirmedContact over this.
        const leads = await Lead.find({ sessionId: { $in: sessions.map((s) => s._id) } })
            .select('sessionId contact')
            .lean();
        const leadBySession = new Map(leads.map((l) => [String(l.sessionId), l.contact]));

        res.json(sessions.map((s) => ({ ...s.toObject(), lead: leadBySession.get(String(s._id)) || null })));
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
agentsRouter.post('/:id/chat', chatRateLimit, requestTimeout(30_000), async (req, res, next) => {
    try {
        const agent = await Agent.findById(req.params.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });

        const messages = req.body.messages || [];
        if (!messages.length) return res.status(400).json({ error: 'messages array is required' });

        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        const query = lastUserMessage?.content || '';

        // 1. Ziyaretçinin teknik derinlik tercihini konuşma geçmişinden çıkar
        const preferredAudience = await classifyAudiencePreference(messages);

        // 2. Bilgi arama (Retrieval)
        let citations = [];
        let contextText = '';
        if (query) {
            const chunks = await retrieve({ productId: String(agent.productId), query, topK: 5, preferredAudience });
            citations = chunks.map(c => ({ sourceId: c.sourceId, text: c.text, score: c.score }));
            contextText = chunks.map((c, i) => `[Citation ${i+1}]\n${c.text}`).join('\n\n');
        }

        // 3. Yapay Zekaya (LLM) Bağlamı ve Soruyu Gönderme
        const audienceInstruction = preferredAudience === 'technical'
            ? 'The visitor wants technical depth — feel free to use precise terminology, implementation/architecture detail.'
            : "The visitor wants a clear, non-technical explanation — cover the substance without jargon or implementation detail unless they ask for it.";
        const systemPrompt = `
You are ${agent.name}, an expert AI sales agent.
Your tone is: ${agent.persona?.tone || 'friendly, expert, concise'}.
Your goals: ${(agent.persona?.goals || []).join(', ')}.

Answer the user's questions strictly based on the following retrieved knowledge context.
If the answer is not in the context, politely say you don't know, but try to be helpful.
When using information from the context, use citations like [Citation 1].
${audienceInstruction}

=== KNOWLEDGE CONTEXT ===
${contextText || 'No specific context found.'}
=========================
        `.trim();

        const llm = getLLM();
        const response = await llm.complete({
            system: systemPrompt,
            messages: messages
        });

        // 4. Konuşma turlarını DB'ye kaydet (fire-and-forget, hata non-fatal)
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

        // 5. Yanıtı dön
        res.json({
            role: 'assistant',
            content: response.text,
            citations: citations
        });
    } catch (err) {
        next(err);
    }
});
