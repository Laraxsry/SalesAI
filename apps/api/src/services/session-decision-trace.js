const DECISION_EVENT_TYPES = new Set([
    'playbook.route_planning.started',
    'playbook.route_proposal.accepted',
    'playbook.route_proposal.rejected',
    'playbook.route_proposal.ignored'
]);

const TECHNICAL_PREFIXES = [
    'playbook.', 'multi_agent.', 'knowledge.', 'survey.', 'screen.', 'tour.', 'tool.'
];

const NODE_OUTCOMES = {
    'playbook.node.enter': 'active',
    'playbook.node.redeliver': 'active',
    'playbook.node.exit': 'completed',
    'playbook.node.failed': 'failed',
    'playbook.node.deferred': 'deferred'
};

function boundedText(value, max = 240) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized ? normalized.slice(0, max) : null;
}

function safeToken(value, max = 120) {
    const text = boundedText(value, max);
    return text && /^[a-zA-Z0-9._:-]+$/.test(text) ? text : null;
}

function safePath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`.slice(0, 500);
    } catch {
        return null;
    }
}

function publicNode(raw = {}, fallback = {}) {
    const type = safeToken(raw.type) || safeToken(raw.mode) || safeToken(fallback.type) || 'narrative';
    return {
        id: safeToken(raw.id || fallback.id, 96),
        order: Number.isFinite(raw.order) ? raw.order : (fallback.order ?? null),
        type,
        objective: boundedText(raw.objective || raw.directive || fallback.objective, 500),
        requirement: safeToken(raw.requirement || fallback.requirement),
        status: safeToken(raw.status || fallback.status) || 'pending',
        source: safeToken(raw.createdBy || raw.semanticSource || fallback.source),
        topicId: safeToken(raw.topicId || raw.semanticIdentity?.topicId || fallback.topicId, 180),
        evidenceCount: Array.isArray(raw.evidenceRefs)
            ? Math.min(raw.evidenceRefs.length, 100)
            : (Number.isFinite(raw.evidenceCount) ? raw.evidenceCount : (fallback.evidenceCount ?? 0)),
        evidenceRefs: Array.isArray(raw.evidenceRefs)
            ? raw.evidenceRefs.map((item) => safeToken(item, 240)).filter(Boolean).slice(0, 20)
            : (fallback.evidenceRefs ?? []),
        page: safePath(raw.page || raw.url || raw.pageIntent?.preferredUrl || fallback.page),
        actionCount: Number.isFinite(raw.actionCount)
            ? raw.actionCount
            : (Array.isArray(raw.actions) ? raw.actions.length : (fallback.actionCount ?? 0))
    };
}

function reviewerResult(meta = {}, seq) {
    return {
        seq,
        reviewerId: safeToken(meta.middlewareId) || 'validator',
        status: safeToken(meta.status) || 'unknown',
        reasonCodes: Array.isArray(meta.reasonCodes)
            ? meta.reasonCodes.map((item) => safeToken(item)).filter(Boolean).slice(0, 10)
            : []
    };
}

function technicalEvent(event) {
    const meta = event.meta || {};
    const status = safeToken(meta.status || meta.event || meta.to || meta.reason);
    return {
        seq: event.seq,
        type: event.type,
        at: event.at,
        durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
        status,
        nodeId: safeToken(meta.nodeId, 96),
        revision: Number.isFinite(meta.resultingRevision)
            ? meta.resultingRevision
            : (Number.isFinite(meta.routeRevision) ? meta.routeRevision : null)
    };
}

/**
 * Pure, bounded read model for the console. SessionEvent remains the source of
 * truth; raw transcript, model reasoning, tool args and form values never pass
 * through this projection.
 */
export function projectSessionDecisionTrace(events = []) {
    const ordered = [...events].sort((a, b) => a.seq - b.seq);
    const revisions = new Map();
    const nodeCatalog = new Map();
    const outcomes = new Map();
    const reviews = [];
    const decisions = [];
    const analysts = [];
    const technical = [];
    let cohort = 'control';
    let configuredMode = 'off';
    let activeRevision = 0;
    let playbookActive = false;
    let routeExecutionEnabled = false;
    let planningStartedSeq = 0;

    for (const event of ordered) {
        const meta = event.meta || {};
        if (TECHNICAL_PREFIXES.some((prefix) => event.type.startsWith(prefix))) {
            technical.push(technicalEvent(event));
        }

        if (event.type === 'playbook.loaded') {
            playbookActive = meta.active === true;
            const nodes = Array.isArray(meta.nodes) ? meta.nodes.map((node, index) => {
                const projected = publicNode(node, { order: index + 1 });
                if (projected.id) nodeCatalog.set(projected.id, projected);
                return projected;
            }).filter((node) => node.id) : [];
            revisions.set(0, {
                revision: 0,
                status: 'initial',
                reason: 'initial_playbook',
                at: event.at,
                nodes,
                reviews: [],
                latencyMs: null
            });
        }

        if (event.type === 'playbook.dynamic_state.rollout_decision') {
            cohort = ['control', 'shadow', 'canary'].includes(meta.cohort) ? meta.cohort : 'control';
            configuredMode = ['off', 'shadow', 'canary'].includes(meta.configuredMode)
                ? meta.configuredMode : configuredMode;
            routeExecutionEnabled = meta.routeExecutionEnabled === true;
        }

        if (event.type === 'playbook.route_reviewed') reviews.push(reviewerResult(meta, event.seq));

        if (DECISION_EVENT_TYPES.has(event.type)) {
            const status = event.type.split('.').at(-1);
            if (status === 'started') planningStartedSeq = event.seq;
            const decision = {
                seq: event.seq,
                status,
                at: event.at,
                baseRevision: Number.isFinite(meta.baseRevision) ? meta.baseRevision : null,
                resultingRevision: Number.isFinite(meta.resultingRevision) ? meta.resultingRevision : null,
                reason: safeToken(meta.reason) || 'customer_context_changed',
                proposedNodeCount: Number.isFinite(meta.proposedNodeCount) ? meta.proposedNodeCount : 0,
                latencyMs: Number.isFinite(event.durationMs) ? event.durationMs : null
            };
            decisions.push(decision);

            if (status === 'accepted' && decision.resultingRevision !== null) {
                const semanticById = new Map((Array.isArray(meta.semanticUnits) ? meta.semanticUnits : [])
                    .map((unit) => [unit.nodeId, unit]));
                const safeNodes = Array.isArray(meta.proposedNodes)
                    ? meta.proposedNodes.map((node, index) => publicNode(node, { order: index + 1 }))
                    : (Array.isArray(meta.proposedNodeIds) ? meta.proposedNodeIds : []).map((id, index) => {
                        const known = nodeCatalog.get(id) || {};
                        const semantic = semanticById.get(id) || {};
                        return publicNode({ id, ...semantic }, { ...known, order: index + 1 });
                    });
                for (const node of safeNodes) if (node.id) nodeCatalog.set(node.id, node);
                const revisionReviews = [
                    ...reviews.filter((review) =>
                        review.seq > planningStartedSeq && review.seq < event.seq),
                    {
                        seq: event.seq,
                        reviewerId: 'validator',
                        status: 'accepted',
                        reasonCodes: []
                    }
                ];
                revisions.set(decision.resultingRevision, {
                    revision: decision.resultingRevision,
                    baseRevision: decision.baseRevision,
                    status: cohort === 'shadow' ? 'proposed_shadow' : 'active',
                    reason: decision.reason,
                    at: event.at,
                    nodes: safeNodes.filter((node) => node.id),
                    reviews: revisionReviews,
                    latencyMs: decision.latencyMs
                });
                if (cohort === 'canary' && routeExecutionEnabled) {
                    activeRevision = decision.resultingRevision;
                }
            }
        }

        if (NODE_OUTCOMES[event.type] && meta.nodeId) {
            const prior = outcomes.get(meta.nodeId);
            const status = event.type === 'playbook.node.exit' && meta.interrupted === true
                ? 'interrupted'
                : NODE_OUTCOMES[event.type];
            if (!prior || status !== 'active') {
                outcomes.set(meta.nodeId, { status, at: event.at, seq: event.seq });
            }
            const known = nodeCatalog.get(meta.nodeId) || {};
            nodeCatalog.set(meta.nodeId, publicNode(meta, known));
        }

        if (event.type === 'playbook.dynamic_demo.execution' && meta.nodeId) {
            const status = meta.event === 'result' ? safeToken(meta.status) : safeToken(meta.event);
            const previous = outcomes.get(meta.nodeId) || {};
            outcomes.set(meta.nodeId, { ...previous, demoStatus: status, at: event.at, seq: event.seq });
        }

        if (event.type === 'multi_agent.analyst.result') {
            analysts.push({
                seq: event.seq,
                at: event.at,
                analystId: safeToken(meta.analystId) || 'unknown',
                status: safeToken(meta.status) || 'unknown',
                proposalType: safeToken(meta.proposalType),
                reason: safeToken(meta.reason)
            });
        }
    }

    for (const revision of revisions.values()) {
        revision.nodes = revision.nodes.map((node) => ({
            ...node,
            ...nodeCatalog.get(node.id),
            status: outcomes.get(node.id)?.status || node.status,
            demoStatus: outcomes.get(node.id)?.demoStatus || null
        }));
    }

    const active = revisions.get(activeRevision) || revisions.get(0) || null;
    const completedNodes = active?.nodes.filter((node) => node.status === 'completed').length ?? 0;
    const activeReviews = active?.reviews ?? [];
    return {
        schemaVersion: 1,
        cohort,
        configuredMode,
        routeExecutionEnabled,
        playbookActive,
        activeRevision,
        summary: {
            revisionCount: revisions.size,
            nodeCount: active?.nodes.length ?? 0,
            completedNodeCount: completedNodes,
            failedNodeCount: active?.nodes.filter((node) => node.status === 'failed').length ?? 0,
            reviewerPassCount: activeReviews.filter((review) =>
                ['passed', 'accepted'].includes(review.status)).length,
            reviewerCount: activeReviews.length,
            analystRunCount: analysts.length
        },
        revisions: [...revisions.values()].sort((a, b) => a.revision - b.revision),
        decisions,
        analysts,
        technical: technical.slice(-300)
    };
}
