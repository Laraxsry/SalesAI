import { resolveRouteSemanticIdentity } from './route-semantic-resolver.js';

function safeIdPart(value) {
    return String(value || 'question')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 42) || 'question';
}

function plannerNode(context, suffix, fields, resolveSemantics) {
    const evidenceRefs = fields.evidenceRefs ?? [];
    return {
        id: `route_${safeIdPart(context.activeQuestion?.id)}_${context.planningGeneration}_${suffix}`,
        requirement: 'preferred',
        sourceQuestionId: context.activeQuestion?.id ?? null,
        deliveryIntent: context.activeQuestion ? 'direct_answer' : 'proactive_promotion',
        semanticIdentity: context.activeQuestion
            ? resolveSemantics({
                context,
                intentId: context.activeQuestion.id,
                evidenceRefs
            })
            : null,
        prerequisites: [],
        completionCriteria: [],
        skipConditions: [],
        pageIntent: null,
        actions: [],
        survey: null,
        maxAttempts: 1,
        timeoutPolicy: 'defer',
        createdBy: 'fallback',
        ...fields
    };
}

function pendingClosingNodes(context) {
    return context.currentRoute.filter((node) => {
        const runtime = context.obligations[node.id];
        return runtime?.requirement === 'required_before_close'
            && !['satisfied', 'declined', 'impossible'].includes(runtime.status);
    });
}

/**
 * Cheap, explainable RoutePlanner implementation. It produces conservative
 * proposals when no model planner is configured or the primary times out.
 */
export function createRulesRoutePlanner({
    resolveSemantics = resolveRouteSemanticIdentity
} = {}) {
    return {
        async propose(context) {
            const evidenceRefs = (context.knowledge?.evidence ?? []).map((item) => item.evidenceId);
            const nodes = [];
            const createNode = (suffix, fields) =>
                plannerNode(context, suffix, fields, resolveSemantics);

            if (context.knowledge?.status === 'grounded'
                || context.knowledge?.status === 'grounded_with_demo') {
                nodes.push(createNode('answer', {
                    type: 'answer',
                    objective: 'Müşterinin aktif sorusunu yalnızca doğrulanmış bilgiyle doğrudan yanıtla.',
                    evidenceRefs
                }));
            }

            if (context.knowledge?.status === 'grounded_with_demo') {
                const target = context.allowedDemoTargets[0];
                const semanticTarget = target?.heading || target?.tabLabel || null;
                nodes.push(createNode('demo', {
                    type: 'demo',
                    objective: 'Yanıtı doğrulayan ürün alanını müşteriye göster.',
                    evidenceRefs,
                    pageIntent: {
                        purpose: 'grounded_customer_question_demo',
                        preferredUrl: target?.pageUrl ?? null
                    },
                    actions: semanticTarget
                        ? [{ intent: 'focus', target: semanticTarget, safety: 'safe' }]
                        : []
                }));
            }

            if (context.knowledge?.status === 'not_found') {
                nodes.push(createNode('clarify_gap', {
                    type: 'ask',
                    objective: 'Doğrulanmamış bir iddiada bulunma; istenen sonucu netleştir ve gerekirse insan takibi için izin sor.',
                    evidenceRefs: []
                }));
            } else if (context.knowledge?.status === 'unavailable') {
                nodes.push(createNode('verification_unavailable', {
                    type: 'handoff',
                    objective: 'Bilginin şu anda doğrulanamadığını açıkça belirt ve güvenli bir sonraki adım sun.',
                    evidenceRefs: []
                }));
            } else if (!context.knowledge) {
                nodes.push(createNode('check', {
                    type: 'check',
                    objective: 'Yanıtın müşterinin sorusunu karşılayıp karşılamadığını kontrol et.',
                    evidenceRefs: []
                }));
            }

            if (context.knowledge?.status === 'grounded'
                || context.knowledge?.status === 'grounded_with_demo') {
                nodes.push(createNode('check', {
                    type: 'check',
                    objective: 'Yanıtın müşterinin sorusunu karşılayıp karşılamadığını kontrol et.',
                    evidenceRefs: []
                }));
            }

            const closingNodes = pendingClosingNodes(context);
            const closingIds = new Set(closingNodes.map((node) => node.id));
            const completedIds = new Set(context.completedNodeIds);
            return {
                baseRevision: context.routeRevision,
                planningGeneration: context.planningGeneration,
                reason: context.reason,
                proposedNodes: [...nodes, ...closingNodes],
                preserveObligationIds: [...closingIds],
                obsoleteOptionalNodeIds: context.currentRoute
                    .filter((node) => !closingIds.has(node.id) && !completedIds.has(node.id))
                    .map((node) => node.id)
            };
        }
    };
}
