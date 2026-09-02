import { Router } from 'express';
import { validate } from '@repo/validation';
import { PreCallSurveyInput } from '@repo/contracts';
import { Product, KnowledgeTopic, KnowledgeSource } from '@repo/database';
import { nextSurveyQuestion, buildTourPlan } from '@repo/ai';
import { clampSurveyAnswers, sanitizeGeneratedPlan } from '@repo/agent';
import { resolveShareLink } from '../services/share-link-sessions.js';
import { underDailyLimit, stashPlan } from '../services/pre-call-plan-store.js';
import { requestTimeout } from '../middleware/request-timeout.js';
import { chatRateLimit, lightPublicRateLimit } from '../middleware/public-rate-limits.js';
import { blockSuspiciousBots } from '../middleware/bot-heuristics.js';

export const prejoinRouter = Router();

/** Product + knowledge context the survey/plan LLM needs. */
async function loadPlanContext(agent) {
    const product = await Product.findById(agent.productId);
    if (!product) return null;
    const canShowScreen = Array.isArray(agent.screenModes) && agent.screenModes.includes('guided-tour');

    const topics = await KnowledgeTopic.find({ productId: product._id, status: 'ready' })
        .select('title body')
        .limit(30)
        .lean();

    const siteMap = [];
    if (canShowScreen && product.websiteUrl) {
        const sources = await KnowledgeSource.find({
            productId: product._id,
            type: { $in: ['url', 'api'] },
            'meta.crawlIndex.pages': { $exists: true }
        }).select('meta.crawlIndex');
        for (const src of sources) {
            for (const [url, page] of Object.entries(src.meta?.crawlIndex?.pages || {})) {
                siteMap.push({ url, title: page.components?.headings?.[0] || null });
            }
        }
    }

    return {
        product: { name: product.name, description: product.description },
        canShowScreen,
        topics,
        topicTitles: topics.map((t) => t.title),
        siteMap,
        language: agent.persona?.language || 'en'
    };
}

/** Common: resolve the link, enforce 1-on-1 + survey-enabled. */
async function resolveSurveyable(token) {
    const resolved = await resolveShareLink(token);
    if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };
    const { agent } = resolved;
    const enabled =
        Boolean(agent.preCallSurveyEnabled) && Math.max(1, Number(agent.maxParticipants) || 1) === 1;
    return { ok: true, agent, enabled };
}

/**
 * GET /prejoin/:shareToken — public info for the join screen (name entry +
 * whether to run the survey).
 */
prejoinRouter.get('/:shareToken', lightPublicRateLimit, requestTimeout(5000), async (req, res, next) => {
    try {
        const resolved = await resolveShareLink(req.params.shareToken);
        if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.error });
        const { agent } = resolved;
        const maxParticipants = Math.max(1, Number(agent.maxParticipants) || 1);
        res.json({
            agentName: agent.name,
            maxParticipants,
            surveyEnabled: Boolean(agent.preCallSurveyEnabled) && maxParticipants === 1
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /prejoin/:shareToken/survey — one round of the adaptive questionnaire.
 * Stateless: the client re-sends every answer so far.
 */
prejoinRouter.post(
    '/:shareToken/survey',
    chatRateLimit,
    blockSuspiciousBots,
    requestTimeout(30_000),
    validate({ body: PreCallSurveyInput }),
    async (req, res, next) => {
        try {
            const r = await resolveSurveyable(req.params.shareToken);
            if (!r.ok) return res.status(r.status).json({ error: r.error });
            if (!r.enabled) return res.json({ done: true }); // survey off → nothing to ask
            if (!(await underDailyLimit(req.params.shareToken))) {
                return res.status(429).json({ error: 'Bu link için günlük anket sınırına ulaşıldı.' });
            }

            const ctx = await loadPlanContext(r.agent);
            if (!ctx) return res.json({ done: true });

            const answers = clampSurveyAnswers(req.body.answers);
            const result = await nextSurveyQuestion({
                product: ctx.product,
                topicTitles: ctx.topicTitles,
                siteMap: ctx.siteMap,
                answers,
                canShowScreen: ctx.canShowScreen,
                language: ctx.language
            });
            // Couldn't even produce the first question — the LLM is unavailable
            // (rate/spend limit). Tell the client to skip the survey outright
            // rather than run a doomed finalize call.
            if (result.done && answers.length === 0) {
                console.warn('[prejoin] survey unavailable (no first question) for', req.params.shareToken);
                return res.json({ done: true, unavailable: true });
            }
            res.json(result.done ? { done: true } : { done: false, question: result.question });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /prejoin/:shareToken/finalize — the survey is done: generate the intent
 * + per-visitor tour plan, stash it in Redis, hand the client an opaque token
 * it passes to POST /sessions.
 */
prejoinRouter.post(
    '/:shareToken/finalize',
    chatRateLimit,
    blockSuspiciousBots,
    requestTimeout(50_000),
    validate({ body: PreCallSurveyInput }),
    async (req, res, next) => {
        try {
            const r = await resolveSurveyable(req.params.shareToken);
            if (!r.ok) return res.status(r.status).json({ error: r.error });
            if (!r.enabled) return res.json({ planToken: null });

            const ctx = await loadPlanContext(r.agent);
            if (!ctx) return res.json({ planToken: null });

            const answers = clampSurveyAnswers(req.body.answers);
            if (!answers.length) return res.json({ planToken: null }); // nothing to plan from

            const { intent } = await nextSurveyQuestion({
                product: ctx.product,
                topicTitles: ctx.topicTitles,
                siteMap: ctx.siteMap,
                answers: [...answers, { q: '__finalize__', a: 'done' }], // nudge to done+intent
                canShowScreen: ctx.canShowScreen,
                language: ctx.language
            }).then((x) => (x.done ? x : { intent: { summary: '' } }));

            const rawPlan = await buildTourPlan({
                product: ctx.product,
                topics: ctx.topics,
                siteMap: ctx.siteMap,
                intent,
                canShowScreen: ctx.canShowScreen,
                language: ctx.language
            });
            const plan = sanitizeGeneratedPlan(rawPlan, {
                siteMapUrls: ctx.siteMap.map((p) => p.url),
                canShowScreen: ctx.canShowScreen
            });

            if (!plan) return res.json({ planToken: null });

            const planToken = await stashPlan({ shareToken: req.params.shareToken, intent, plan });
            if (!planToken) return res.json({ planToken: null }); // Redis down → proceed without a plan

            res.json({
                planToken,
                stepCount: plan.steps.length,
                preview: plan.steps.map((s) => ({ label: s.coverage || s.narration.slice(0, 60) }))
            });
        } catch (err) {
            next(err);
        }
    }
);
