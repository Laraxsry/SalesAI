import {
    AskedQuestionRecordInput,
    ConcernMemoryRecordInput,
    ConversationMemoryInput,
    CoverageRecordInput,
    DeclineRecordInput,
    DiscoveredFactInput,
    PlanningMemoryViewInput
} from '@repo/contracts';

const COVERAGE_RANK = {
    mentioned: 1,
    explained: 2,
    demonstrated: 3,
    confirmed: 4,
    rejected: 5
};

function sameCoverage(record, candidate) {
    return record.nodeId === candidate.nodeId
        && record.routeRevision === candidate.routeRevision
        && record.status === candidate.status
        && record.claimId === candidate.claimId;
}

function appendCoverage(memory, input) {
    const parsed = CoverageRecordInput.safeParse(input);
    if (!parsed.success) return memory;
    const record = parsed.data;
    const history = memory.coveredTopics[record.topicId] ?? [];
    if (history.some((existing) => sameCoverage(existing, record))) return memory;
    return {
        ...memory,
        coveredTopics: {
            ...memory.coveredTopics,
            [record.topicId]: [...history, record].slice(-100)
        }
    };
}

function recordNodeCoverage(memory, event, context) {
    const node = context.route.find((candidate) => candidate.id === event.nodeId);
    if (!node?.semanticIdentity) return memory;
    const status = node.type === 'demo'
        ? 'demonstrated'
        : ['answer', 'obligation'].includes(node.type)
            ? 'explained'
            : 'mentioned';
    const history = memory.coveredTopics[node.semanticIdentity.topicId] ?? [];
    const proactive = node.deliveryIntent === 'proactive_promotion';
    const previousMentionCount = Math.max(0, ...history.map((record) =>
        record.proactiveMentionCount));
    const previousDemoCount = Math.max(0, ...history.map((record) =>
        record.proactiveDemoCount));
    const claimIds = node.semanticIdentity.claimIds.length
        ? node.semanticIdentity.claimIds
        : [null];

    return claimIds.reduce((current, claimId) => appendCoverage(current, {
        topicId: node.semanticIdentity.topicId,
        claimId,
        status,
        deliveryIntent: node.deliveryIntent,
        nodeId: node.id,
        routeRevision: context.routeRevision,
        turnIndex: memory.turnIndex,
        proactiveMentionCount: previousMentionCount + (proactive ? 1 : 0),
        proactiveDemoCount: previousDemoCount + (proactive && node.type === 'demo' ? 1 : 0),
        evidenceIds: node.evidenceRefs
    }), memory);
}

/** Pure reducer for durable session memory; route revisions never clear it. */
export function reduceConversationMemory(memoryInput, event, context = {}) {
    const parsedMemory = ConversationMemoryInput.safeParse(memoryInput);
    if (!parsedMemory.success) return memoryInput;
    // Runtime state has already crossed the contract boundary. Keep its
    // reference for no-op events so the outer store can suppress phantom
    // transitions; use parsed data only for non-canonical external input.
    const memory = memoryInput && typeof memoryInput === 'object'
        && Object.hasOwn(memoryInput, 'coveredTopics')
        ? memoryInput
        : parsedMemory.data;
    const routeContext = {
        route: context.route ?? [],
        routeRevision: context.routeRevision ?? 0
    };

    switch (event?.type) {
        case 'MEMORY_TURN_ADVANCED':
            return { ...memory, turnIndex: memory.turnIndex + 1 };
        case 'NODE_COMPLETED':
            return recordNodeCoverage(memory, event, routeContext);
        case 'COVERAGE_RECORDED':
            return appendCoverage(memory, {
                ...event.record,
                turnIndex: event.record?.turnIndex ?? memory.turnIndex,
                routeRevision: event.record?.routeRevision ?? routeContext.routeRevision
            });
        case 'FACT_DISCOVERED': {
            const fact = DiscoveredFactInput.safeParse({
                ...event.fact,
                capturedTurnIndex: event.fact?.capturedTurnIndex ?? memory.turnIndex
            });
            if (!fact.success) return memory;
            const current = memory.discoveredFacts[fact.data.key];
            if (current && current.confidence >= fact.data.confidence) return memory;
            return {
                ...memory,
                discoveredFacts: { ...memory.discoveredFacts, [fact.data.key]: fact.data }
            };
        }
        case 'QUESTION_RECORDED': {
            const question = AskedQuestionRecordInput.safeParse({
                ...event.question,
                askedTurnIndex: event.question?.askedTurnIndex ?? memory.turnIndex
            });
            if (!question.success) return memory;
            const current = memory.askedQuestions[question.data.questionKey];
            if (current && ['declined', 'dismissed', 'expired'].includes(current.status)
                && question.data.status === 'asked') return memory;
            return {
                ...memory,
                askedQuestions: {
                    ...memory.askedQuestions,
                    [question.data.questionKey]: question.data
                }
            };
        }
        case 'CONCERN_MEMORY_UPDATED': {
            const concern = ConcernMemoryRecordInput.safeParse({
                ...event.concern,
                updatedTurnIndex: event.concern?.updatedTurnIndex ?? memory.turnIndex
            });
            if (!concern.success) return memory;
            return {
                ...memory,
                customerConcerns: {
                    ...memory.customerConcerns,
                    [concern.data.concernId]: concern.data
                }
            };
        }
        case 'TOPIC_DECLINED': {
            const decline = DeclineRecordInput.safeParse({
                ...event.decline,
                turnIndex: event.decline?.turnIndex ?? memory.turnIndex
            });
            if (!decline.success) return memory;
            return {
                ...memory,
                declinedTopics: {
                    ...memory.declinedTopics,
                    [decline.data.topicId]: decline.data
                }
            };
        }
        default:
            return memory;
    }
}

export function projectPlanningMemory(memoryInput) {
    const memory = ConversationMemoryInput.parse(memoryInput);
    const coveredClaims = Object.values(memory.coveredTopics).flatMap((history) => {
        const groups = new Map();
        for (const record of history) {
            const key = record.claimId ?? '__topic__';
            const current = groups.get(key);
            groups.set(key, {
                topicId: record.topicId,
                claimId: record.claimId,
                highestStatus: !current
                    || COVERAGE_RANK[record.status] > COVERAGE_RANK[current.highestStatus]
                    ? record.status
                    : current.highestStatus,
                lastDeliveryIntent: !current || record.turnIndex >= current.lastTurnIndex
                    ? record.deliveryIntent
                    : current.lastDeliveryIntent,
                proactiveMentionCount: Math.max(
                    current?.proactiveMentionCount ?? 0,
                    record.proactiveMentionCount
                ),
                proactiveDemoCount: Math.max(
                    current?.proactiveDemoCount ?? 0,
                    record.proactiveDemoCount
                ),
                lastTurnIndex: Math.max(current?.lastTurnIndex ?? 0, record.turnIndex)
            });
        }
        return [...groups.values()];
    }).sort((a, b) => a.topicId.localeCompare(b.topicId)
        || String(a.claimId).localeCompare(String(b.claimId)))
        .slice(0, 500);

    return PlanningMemoryViewInput.parse({
        turnIndex: memory.turnIndex,
        coveredClaims,
        knownFacts: Object.values(memory.discoveredFacts)
            .sort((a, b) => a.key.localeCompare(b.key)).slice(0, 100),
        unresolvedConcerns: Object.values(memory.customerConcerns)
            .filter((concern) => concern.status !== 'resolved')
            .sort((a, b) => a.concernId.localeCompare(b.concernId)).slice(0, 100),
        declinedTopics: Object.keys(memory.declinedTopics).sort().slice(0, 100)
    });
}
