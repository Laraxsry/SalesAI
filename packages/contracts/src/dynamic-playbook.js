import { z } from 'zod';

/**
 * Runtime-neutral contracts for the dynamic playbook engine.
 *
 * These schemas deliberately live outside the agent worker: the API, replay
 * tooling and future planner adapters must agree on the same intermediate
 * representation without depending on LiveKit or browser execution details.
 */

export const DynamicPlaybookNodeType = z.enum([
    'answer',
    'demo',
    'ask',
    'check',
    'obligation',
    'handoff'
]);

export const DynamicPlaybookRequirement = z.enum([
    'required_before_close',
    'required_if_relevant',
    'preferred',
    'optional'
]);

export const DynamicPlaybookCreatedBy = z.enum([
    'initial_contract',
    'planner',
    'fallback'
]);

const CanonicalTopicId = z.string().trim()
    .regex(/^topic:[a-z0-9][a-z0-9._:-]{0,153}$/);
const CanonicalClaimId = z.string().trim()
    .regex(/^claim:[a-z0-9][a-z0-9._:-]{0,153}$/);

export const DynamicPlaybookSemanticIdentityInput = z.object({
    topicId: CanonicalTopicId,
    claimIds: z.array(CanonicalClaimId).max(20).default([]),
    source: z.enum(['authored', 'compiler_fallback', 'knowledge_intent', 'semantic_resolver'])
});

export const CoverageStatus = z.enum([
    'mentioned',
    'explained',
    'demonstrated',
    'confirmed',
    'rejected'
]);

export const DeliveryIntent = z.enum([
    'proactive_promotion',
    'direct_answer',
    'clarification',
    'recap',
    'comparison'
]);

export const CoverageRecordInput = z.object({
    topicId: CanonicalTopicId,
    claimId: CanonicalClaimId.nullable().default(null),
    status: CoverageStatus,
    deliveryIntent: DeliveryIntent,
    nodeId: z.string().trim().min(1).max(96),
    routeRevision: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    proactiveMentionCount: z.number().int().min(0),
    proactiveDemoCount: z.number().int().min(0),
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(20).default([])
});

export const DiscoveredFactInput = z.object({
    key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    value: z.unknown(),
    source: z.enum(['crm', 'conversation', 'survey', 'operator']),
    confidence: z.number().min(0).max(1),
    capturedTurnIndex: z.number().int().min(0),
    evidenceRef: z.string().trim().min(1).max(240).nullable().default(null)
});

export const AskedQuestionRecordInput = z.object({
    questionKey: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    channel: z.enum(['voice', 'survey']),
    status: z.enum(['asked', 'answered', 'declined', 'dismissed', 'expired', 'cancelled']),
    askedTurnIndex: z.number().int().min(0),
    answerRef: z.string().trim().min(1).max(240).nullable().default(null)
});

export const ConcernMemoryRecordInput = z.object({
    concernId: z.string().trim().min(1).max(160),
    status: z.enum(['open', 'resolved', 'deferred']),
    updatedTurnIndex: z.number().int().min(0)
});

export const DeclineRecordInput = z.object({
    topicId: CanonicalTopicId,
    reason: z.string().trim().min(1).max(120),
    turnIndex: z.number().int().min(0)
});

export const ConversationMemoryInput = z.object({
    turnIndex: z.number().int().min(0).default(0),
    coveredTopics: z.record(z.array(CoverageRecordInput).max(100)).default({}),
    discoveredFacts: z.record(DiscoveredFactInput).default({}),
    askedQuestions: z.record(AskedQuestionRecordInput).default({}),
    customerConcerns: z.record(ConcernMemoryRecordInput).default({}),
    declinedTopics: z.record(DeclineRecordInput).default({})
});

export const PlanningMemoryViewInput = z.object({
    turnIndex: z.number().int().min(0).default(0),
    coveredClaims: z.array(z.object({
        topicId: CanonicalTopicId,
        claimId: CanonicalClaimId.nullable(),
        highestStatus: CoverageStatus,
        lastDeliveryIntent: DeliveryIntent,
        proactiveMentionCount: z.number().int().min(0),
        proactiveDemoCount: z.number().int().min(0),
        lastTurnIndex: z.number().int().min(0)
    })).max(500).default([]),
    knownFacts: z.array(DiscoveredFactInput).max(100).default([]),
    unresolvedConcerns: z.array(ConcernMemoryRecordInput).max(100).default([]),
    declinedTopics: z.array(CanonicalTopicId).max(100).default([])
});

export const SurveyPurpose = z.enum([
    'qualification',
    'personalization',
    'pricing_context',
    'demo_routing'
]);

export const AdaptiveSurveyAnswerType = z.enum([
    'single_select',
    'multi_select',
    'short_text',
    'number'
]);

export const SurveyProposalInput = z.object({
    proposalId: z.string().trim().min(1).max(96),
    baseRevision: z.number().int().min(0),
    epoch: z.number().int().min(0),
    purpose: SurveyPurpose,
    questionKey: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    question: z.string().trim().min(1).max(400),
    reason: z.string().trim().min(1).max(400),
    answerType: AdaptiveSurveyAnswerType,
    options: z.array(z.object({
        value: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
        label: z.string().trim().min(1).max(120)
    })).max(6).default([]),
    requiredFor: z.array(z.enum([
        'demo_route', 'pricing', 'qualification', 'handoff'
    ])).min(1).max(4),
    blocking: z.boolean().default(false),
    confidenceThatUnknown: z.number().min(0).max(1)
}).superRefine((proposal, ctx) => {
    const select = ['single_select', 'multi_select'].includes(proposal.answerType);
    if (select && proposal.options.length < 2) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options'],
            message: 'select surveys require between two and six options'
        });
    }
    if (!select && proposal.options.length > 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options'],
            message: 'non-select surveys cannot define options'
        });
    }
    const values = proposal.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options'],
            message: 'survey option values must be unique'
        });
    }
});

export const SurveyPolicyInput = z.object({
    enabled: z.boolean().default(true),
    allowDynamicQuestions: z.boolean().default(true),
    maxPerSession: z.number().int().min(0).max(10).default(3),
    cooldownTurns: z.number().int().min(0).max(50).default(4),
    minUnknownConfidence: z.number().min(0).max(1).default(0.7),
    allowedPurposes: z.array(SurveyPurpose).default([
        'qualification', 'personalization', 'pricing_context', 'demo_routing'
    ]),
    prohibitedFields: z.array(z.string().trim().min(1).max(64)).max(100).default([
        'password', 'payment_card', 'government_id'
    ]),
    defaultBlocking: z.literal(false).default(false)
});

export const DiscoveryFieldDefinitionInput = z.object({
    key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    importance: z.enum(['required', 'recommended', 'optional', 'do_not_ask']),
    affects: z.array(z.enum([
        'demo_route', 'pricing', 'qualification', 'handoff'
    ])).max(4).default([]),
    preferredInput: z.enum([
        'voice', 'single_select', 'multi_select', 'short_text'
    ]).nullable().default(null)
});

export const KnownFactResolutionInput = z.object({
    key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    status: z.enum(['known', 'verify', 'unknown', 'conflict', 'declined', 'unavailable']),
    fact: DiscoveredFactInput.nullable().default(null),
    candidates: z.array(DiscoveredFactInput).max(20).default([]),
    reason: z.string().trim().min(1).max(120)
});

export const SurveyDecisionStatus = z.enum([
    'approved', 'rejected', 'deferred', 'verify_voice'
]);

export const AdaptiveSurveyRuntimeStateInput = z.object({
    epoch: z.number().int().min(0).default(0),
    activeSurveyId: z.string().trim().min(1).max(96).nullable().default(null),
    approvedProposal: SurveyProposalInput.nullable().default(null),
    shownCount: z.number().int().min(0).default(0),
    lastOpenedTurn: z.number().int().min(0).nullable().default(null),
    lastDecision: z.object({
        proposalId: z.string().trim().min(1).max(96),
        status: SurveyDecisionStatus,
        reason: z.string().trim().min(1).max(120),
        channel: z.enum(['survey', 'voice']).nullable().default(null)
    }).nullable().default(null)
});

function safeSemanticPart(value) {
    return String(value ?? '')
        .toLocaleLowerCase('en-US')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9._:-]+/g, '_')
        .replace(/^[_:.-]+|[_:.-]+$/g, '')
        .slice(0, 96) || 'unknown';
}

/** Stable fallback identity; semantic registries may replace it at compile time. */
export function semanticIdentityForLegacyNode(node) {
    const id = safeSemanticPart(node?.id);
    return DynamicPlaybookSemanticIdentityInput.parse({
        topicId: `topic:legacy:${id}`,
        claimIds: [`claim:legacy:${id}`],
        source: 'compiler_fallback'
    });
}

/** All answer/demo/check nodes for one resolved question share this identity. */
export function semanticIdentityForKnowledgeIntent(intentId, evidenceRefs = []) {
    const intent = safeSemanticPart(intentId);
    return DynamicPlaybookSemanticIdentityInput.parse({
        topicId: `topic:knowledge:${intent}`,
        claimIds: [...new Set(evidenceRefs.map((reference) =>
            `claim:evidence:${safeSemanticPart(reference)}`))],
        source: 'knowledge_intent'
    });
}

export const DynamicPlaybookActionInput = z.object({
    intent: z.enum(['focus', 'click', 'scroll', 'fill', 'navigate', 'resolve']),
    target: z.string().trim().min(1).max(240),
    safety: z.enum(['safe', 'unclassified', 'destructive']).default('unclassified')
});

export const DynamicPlaybookPageIntentInput = z.object({
    purpose: z.string().trim().min(1).max(120),
    // A planner preference, never an execution grant. The later deterministic
    // route validator must still check product-domain allowlists before use.
    preferredUrl: z.string().url().nullable().default(null)
});

export const DynamicPlaybookSurveyInput = z.object({
    question: z.string().trim().min(1).max(400),
    fieldKey: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/).nullable().default(null),
    answerType: z.enum(['single-choice', 'text']).default('single-choice'),
    options: z.array(z.object({
        value: z.string().trim().min(1).max(64),
        label: z.string().trim().min(1).max(120)
    })).max(8).default([]),
    allowFreeText: z.boolean().default(false),
    required: z.boolean().default(true)
}).superRefine((survey, ctx) => {
    if (survey.answerType === 'single-choice' && survey.options.length < 2) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options'],
            message: 'single-choice surveys require at least two options'
        });
    }
    if (survey.answerType === 'text' && survey.options.length > 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options'],
            message: 'text surveys cannot define options'
        });
    }
    const optionValues = survey.options.map((option) => option.value);
    if (new Set(optionValues).size !== optionValues.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options'],
            message: 'survey option values must be unique'
        });
    }
});

export const DynamicPlaybookNodeInput = z.object({
    id: z.string().trim().min(1).max(96),
    type: DynamicPlaybookNodeType,
    objective: z.string().trim().min(1).max(800),
    requirement: DynamicPlaybookRequirement.default('optional'),
    sourceQuestionId: z.string().trim().min(1).max(160).nullable().default(null),
    semanticIdentity: DynamicPlaybookSemanticIdentityInput.nullable().default(null),
    deliveryIntent: DeliveryIntent.default('proactive_promotion'),
    evidenceRefs: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
    prerequisites: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    completionCriteria: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    skipConditions: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    pageIntent: DynamicPlaybookPageIntentInput.nullable().default(null),
    actions: z.array(DynamicPlaybookActionInput).max(10).default([]),
    survey: DynamicPlaybookSurveyInput.nullable().default(null),
    maxAttempts: z.number().int().min(1).max(5).default(1),
    timeoutPolicy: z.enum(['skip', 'defer', 'defer_and_answer', 'fail']).default('defer'),
    createdBy: DynamicPlaybookCreatedBy.default('initial_contract')
}).superRefine((node, ctx) => {
    if (node.type === 'ask' && node.survey === null) return;
    if (node.type !== 'ask' && node.survey !== null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['survey'],
            message: 'only ask nodes can carry survey configuration'
        });
    }
});

export const PlaybookObligationInput = z.object({
    id: z.string().trim().min(1).max(96),
    objective: z.string().trim().min(1).max(800),
    requirement: z.enum(['required_before_close', 'required_if_relevant']),
    prerequisites: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    completionCriteria: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
    fallback: z.string().trim().min(1).max(120).nullable().default(null),
    maxAttempts: z.number().int().min(1).max(5).default(1)
});

function addDuplicateIdIssues(items, path, ctx) {
    const seen = new Set();
    items.forEach((item, index) => {
        if (seen.has(item.id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [path, index, 'id'],
                message: `duplicate id: ${item.id}`
            });
        }
        seen.add(item.id);
    });
}

export const CompiledPlaybookContractInput = z.object({
    schemaVersion: z.literal(1).default(1),
    id: z.string().trim().min(1).max(120),
    sourceVersion: z.number().int().min(1).nullable().default(null),
    nodes: z.array(DynamicPlaybookNodeInput).max(80).default([]),
    obligations: z.array(PlaybookObligationInput).max(20).default([])
}).superRefine((contract, ctx) => {
    addDuplicateIdIssues(contract.nodes, 'nodes', ctx);
    addDuplicateIdIssues(contract.obligations, 'obligations', ctx);

    const nodeIds = new Set(contract.nodes.map((node) => node.id));
    contract.obligations.forEach((obligation, index) => {
        if (!nodeIds.has(obligation.id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['obligations', index, 'id'],
                message: 'obligation must reference a node with the same id'
            });
        }
    });
});

export const RouteRevisionInput = z.object({
    revision: z.number().int().min(0),
    baseRevision: z.number().int().min(0).nullable().default(null),
    reason: z.string().trim().min(1).max(240),
    nodes: z.array(DynamicPlaybookNodeInput).max(80)
}).superRefine((route, ctx) => {
    addDuplicateIdIssues(route.nodes, 'nodes', ctx);
});

export const ObligationRuntimeStatus = z.enum([
    'pending',
    'deferred',
    'active',
    'satisfied',
    'declined',
    'impossible'
]);

export const ObligationRuntimeStateInput = z.object({
    requirement: z.enum(['required_before_close', 'required_if_relevant']),
    status: ObligationRuntimeStatus.default('pending'),
    attempts: z.number().int().min(0).default(0),
    completionEvidence: z.array(z.string().trim().min(1).max(240)).max(30).default([])
});

export const ConversationPhase = z.enum([
    'opening',
    'discovery',
    'value_delivery',
    'resolution',
    'closing',
    'complete'
]);

export const ConversationActivity = z.enum([
    'listening',
    'understanding',
    'retrieving',
    'planning',
    'answering',
    'demonstrating',
    'checking',
    'waiting'
]);

export const DynamicPlaybookRuntimeStateInput = z.object({
    sessionId: z.string().trim().min(1).max(120),
    contractId: z.string().trim().min(1).max(120),
    routeRevision: z.number().int().min(0).default(0),
    conversationPhase: ConversationPhase.default('opening'),
    activity: ConversationActivity.default('listening'),
    activeNodeId: z.string().trim().min(1).max(96).nullable().default(null),
    route: z.array(DynamicPlaybookNodeInput).max(80).default([]),
    obligations: z.record(ObligationRuntimeStateInput).default({}),
    completedNodeIds: z.array(z.string()).default([]),
    skippedNodeIds: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
    discoveredNeeds: z.array(z.string()).default([]),
    openConcerns: z.array(z.string()).default([]),
    evidenceLedger: z.array(z.string()).default([]),
    capabilityRequests: z.array(z.string()).default([]),
    memory: ConversationMemoryInput.default({}),
    adaptiveSurvey: AdaptiveSurveyRuntimeStateInput.default({}),
    planning: z.object({
        status: z.enum(['idle', 'planning', 'accepted', 'rejected']).default('idle'),
        generation: z.number().int().min(0).default(0),
        lastReason: z.string().nullable().default(null),
        lastRejection: z.string().nullable().default(null)
    }).default({})
});

export const KnowledgeResolutionStatus = z.enum([
    'grounded',
    'grounded_with_demo',
    'not_found',
    'unavailable'
]);

export const KnowledgeEvidenceInput = z.object({
    evidenceId: z.string().trim().min(1).max(160),
    kind: z.literal('knowledge'),
    text: z.string().trim().min(1),
    score: z.number(),
    sourceId: z.string().trim().min(1).max(160),
    page: z.object({
        url: z.string().url(),
        tabLabel: z.string().nullable().default(null),
        elementKey: z.string().nullable().default(null),
        elementPath: z.string().nullable().default(null),
        elementType: z.string().nullable().default(null),
        heading: z.string().nullable().default(null)
    }).nullable().default(null)
});

export const DemoTargetInput = z.object({
    pageUrl: z.string().url(),
    tabLabel: z.string().nullable().default(null),
    elementKey: z.string().nullable().default(null),
    elementPath: z.string().nullable().default(null),
    elementType: z.string().nullable().default(null),
    heading: z.string().nullable().default(null)
});

export const KnowledgeResolutionResultInput = z.object({
    intentId: z.string().trim().min(1).max(160),
    query: z.string().trim().min(1).max(1000),
    status: KnowledgeResolutionStatus,
    evidence: z.array(KnowledgeEvidenceInput).max(50).default([]),
    demoTargets: z.array(DemoTargetInput).max(20).default([]),
    knowledgeGap: z.object({
        status: z.enum(['none', 'candidate', 'confirmed']),
        reason: z.string().nullable().default(null)
    })
}).superRefine((result, ctx) => {
    if (result.status === 'not_found' && result.knowledgeGap.status !== 'candidate') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['knowledgeGap', 'status'],
            message: 'not_found results must remain knowledge-gap candidates until separately confirmed'
        });
    }
    if (result.status.startsWith('grounded') && result.evidence.length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence'],
            message: 'grounded results require evidence'
        });
    }
    if ((result.status === 'not_found' || result.status === 'unavailable')
        && (result.evidence.length > 0 || result.demoTargets.length > 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence'],
            message: `${result.status} results cannot carry grounding evidence or demo targets`
        });
    }
    if (result.status === 'grounded_with_demo' && result.demoTargets.length === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['demoTargets'],
            message: 'grounded_with_demo results require at least one demo target'
        });
    }
});

export const CapabilityRequestInput = z.object({
    requestedOutcome: z.string().trim().min(1).max(1000),
    customerContext: z.string().trim().max(2000).nullable().default(null),
    sourceIntentId: z.string().trim().min(1).max(160).nullable().default(null),
    evidenceStatus: z.enum(['not_found', 'unsupported', 'partial']),
    consentToContact: z.literal(true),
    prioritySignals: z.array(z.string().trim().min(1).max(120)).max(12).default([])
});

export const RoutePlanningContextInput = z.object({
    sessionId: z.string().trim().min(1).max(120),
    contractId: z.string().trim().min(1).max(120),
    routeRevision: z.number().int().min(0),
    planningGeneration: z.number().int().min(1),
    reason: z.string().trim().min(1).max(240),
    activeQuestion: z.object({
        id: z.string().trim().min(1).max(160),
        text: z.string().trim().min(1).max(1000)
    }).nullable().default(null),
    knowledge: KnowledgeResolutionResultInput.nullable().default(null),
    currentRoute: z.array(DynamicPlaybookNodeInput).max(80),
    obligations: z.record(ObligationRuntimeStateInput).default({}),
    completedNodeIds: z.array(z.string()).default([]),
    evidenceIds: z.array(z.string()).default([]),
    memory: PlanningMemoryViewInput.default({}),
    allowedDemoTargets: z.array(DemoTargetInput).max(20).default([]),
    maxRouteNodes: z.number().int().min(1).max(80).default(20)
});

export const RouteProposalInput = z.object({
    baseRevision: z.number().int().min(0),
    planningGeneration: z.number().int().min(1),
    reason: z.string().trim().min(1).max(240),
    proposedNodes: z.array(DynamicPlaybookNodeInput).min(1).max(80),
    preserveObligationIds: z.array(z.string().trim().min(1).max(96)).max(20).default([]),
    obsoleteOptionalNodeIds: z.array(z.string().trim().min(1).max(96)).max(80).default([])
}).superRefine((proposal, ctx) => {
    addDuplicateIdIssues(proposal.proposedNodes, 'proposedNodes', ctx);
    for (const [field, values] of [
        ['preserveObligationIds', proposal.preserveObligationIds],
        ['obsoleteOptionalNodeIds', proposal.obsoleteOptionalNodeIds]
    ]) {
        if (new Set(values).size !== values.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [field],
                message: `${field} must contain unique ids`
            });
        }
    }
});

/**
 * Conservatively compiles the existing ordered playbook into the V1 dynamic
 * contract. No legacy `important` node is silently promoted to a hard
 * obligation: callers must explicitly name required-before-close node ids.
 * That keeps migration reversible and prevents an old emphasis flag from
 * becoming a new customer-blocking requirement by accident.
 *
 * @param {Array<object>} nodes normalized legacy playbook nodes
 * @param {{contractId:string, sourceVersion?:number|null, requiredBeforeCloseNodeIds?:string[], resolveSemantics?:(node:object)=>object}} options
 */
export function compileLegacyPlaybook(nodes, {
    contractId,
    sourceVersion = null,
    requiredBeforeCloseNodeIds = [],
    resolveSemantics = semanticIdentityForLegacyNode
}) {
    const requiredIds = new Set(requiredBeforeCloseNodeIds);
    const compiledNodes = nodes.map((node) => {
        const requiredBeforeClose = requiredIds.has(node.id);
        const type = node.type === 'survey'
            ? 'ask'
            : requiredBeforeClose
                ? 'obligation'
                : node.url || node.actions?.length
                    ? 'demo'
                    : 'answer';

        return DynamicPlaybookNodeInput.parse({
            id: node.id,
            type,
            objective: node.directive,
            requirement: requiredBeforeClose
                ? 'required_before_close'
                : node.mode === 'skip-if-no-answer'
                    ? 'optional'
                    : 'preferred',
            semanticIdentity: resolveSemantics(node),
            deliveryIntent: 'proactive_promotion',
            completionCriteria: [node.type === 'survey' ? 'survey_answered_or_declined' : 'legacy_node_satisfied'],
            pageIntent: node.url
                ? { purpose: `legacy_node:${node.id}`, preferredUrl: node.url }
                : null,
            actions: (node.actions || []).map((target) => ({ intent: 'resolve', target })),
            survey: node.type === 'survey' ? node.survey : null,
            timeoutPolicy: node.mode === 'skip-if-no-answer' ? 'skip' : 'defer',
            createdBy: 'initial_contract'
        });
    });

    const obligations = compiledNodes
        .filter((node) => node.requirement === 'required_before_close')
        .map((node) => PlaybookObligationInput.parse({
            id: node.id,
            objective: node.objective,
            requirement: 'required_before_close',
            prerequisites: [
                'no_active_customer_question',
                'no_active_demo',
                'concerns_addressed_or_deferred'
            ],
            completionCriteria: node.completionCriteria,
            fallback: 'offer_async_followup',
            maxAttempts: node.maxAttempts
        }));

    return CompiledPlaybookContractInput.parse({
        id: contractId,
        sourceVersion,
        nodes: compiledNodes,
        obligations
    });
}
