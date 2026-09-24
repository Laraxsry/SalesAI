import { createHash } from 'node:crypto';
import { TIMELINE_EVENTS } from './session-timeline.js';

export const REPLAY_FIXTURE_SCHEMA_VERSION = 1;

const INCLUDED_EVENT_TYPES = new Set([
    TIMELINE_EVENTS.PLAYBOOK_NODE_EXIT,
    TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_STATE_TRANSITION,
    TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_COMPLETION_BLOCKED,
    TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_ROLLOUT_DECISION,
    TIMELINE_EVENTS.MEMORY_PROMOTION_DECISION,
    TIMELINE_EVENTS.ROUTE_PLANNING_STARTED,
    TIMELINE_EVENTS.ROUTE_PROPOSAL_ACCEPTED,
    TIMELINE_EVENTS.ROUTE_PROPOSAL_REJECTED,
    TIMELINE_EVENTS.ROUTE_PROPOSAL_IGNORED,
    TIMELINE_EVENTS.ROUTE_REVIEWED,
    TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION,
    TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE,
    TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG,
    TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_OBSERVATION,
    TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_PROPOSAL,
    TIMELINE_EVENTS.MULTI_AGENT_ROLLOUT_DECISION,
    TIMELINE_EVENTS.MULTI_AGENT_EVENT_PUBLISHED,
    TIMELINE_EVENTS.MULTI_AGENT_ANALYST_RUN,
    TIMELINE_EVENTS.MULTI_AGENT_ANALYST_RESULT,
    TIMELINE_EVENTS.MULTI_AGENT_MEMORY_APPLIED,
    TIMELINE_EVENTS.DYNAMIC_DEMO_EXECUTION,
    TIMELINE_EVENTS.KNOWLEDGE_RESOLVED,
    TIMELINE_EVENTS.KNOWLEDGE_NOT_FOUND,
    TIMELINE_EVENTS.KNOWLEDGE_UNAVAILABLE
]);

function finiteNumber(value, fallback = null) {
    return Number.isFinite(value) ? value : fallback;
}

function boundedCount(value) {
    const number = finiteNumber(value, 0);
    return Math.max(0, Math.min(1000, Math.trunc(number)));
}

function safeToken(value) {
    const token = String(value ?? '').trim();
    return /^[a-zA-Z0-9_.:-]{1,96}$/.test(token) ? token : null;
}

const SURVEY_LIFECYCLE_EVENTS = new Set([
    'queued', 'cancelled', 'deferred', 'failed', 'opened', 'answered',
    'dismissed', 'expired', 'publish_failed', 'persistence_failed',
    'acknowledgement_failed', 'replan_failed', 'customer_interrupted',
    'static_survey_started', 'new_customer_utterance', 'session_ended'
]);
const SURVEY_ANSWER_TYPES = new Set(['single_select', 'multi_select', 'short_text', 'number']);
const ROLLOUT_COHORTS = new Set(['control', 'shadow', 'canary']);
const SURVEY_ACTIVATION_REASONS = new Set([
    'feature_disabled', 'product_not_opted_in', 'not_canary',
    'group_session_unsupported', 'no_explicit_targets',
    'target_not_allowlisted', 'explicit_canary_target',
    'enabled_for_active_session'
]);
const SURVEY_REVIEWER_IDS = new Set(['known_fact', 'conversation_timing', 'model_critic']);
const SURVEY_REVIEW_STATUSES = new Set([
    'passed', 'flagged', 'skipped_timeout', 'skipped_error',
    'skipped_invalid_output', 'skipped_invalid_reviewer',
    'skipped_pipeline_error', 'skipped_disabled'
]);
const SHADOW_OBSERVATION_STATUSES = new Set([
    'unknown_field_candidate', 'already_known', 'previously_declined',
    'verify_voice', 'unavailable'
]);
const FACT_STATUSES = new Set([
    'known', 'verify', 'unknown', 'conflict', 'declined', 'unavailable'
]);
const SHADOW_PROPOSAL_STATUSES = new Set([
    'approved', 'rejected', 'deferred', 'verify_voice', 'ignored'
]);

function surveyReviewStatus(value) {
    if (typeof value !== 'string') return null;
    const [id, status, extra] = value.split(':');
    return !extra && SURVEY_REVIEWER_IDS.has(id) && SURVEY_REVIEW_STATUSES.has(status)
        ? `${id}:${status}` : null;
}

function createPseudonymizer(salt) {
    const cache = new Map();
    return (kind, value) => {
        if (value === null || value === undefined || value === '') return null;
        const cacheKey = `${kind}:${String(value)}`;
        if (!cache.has(cacheKey)) {
            const digest = createHash('sha256')
                .update(`${salt}:${cacheKey}`)
                .digest('hex')
                .slice(0, 16);
            cache.set(cacheKey, `${kind}:anon:${digest}`);
        }
        return cache.get(cacheKey);
    };
}

function semanticUnit(unit, pseudonymize) {
    if (!unit || typeof unit !== 'object') return null;
    return {
        nodeId: pseudonymize('node', unit.nodeId),
        topicId: pseudonymize('topic', unit.topicId),
        claimIds: (unit.claimIds ?? []).map((id) => pseudonymize('claim', id)).filter(Boolean),
        source: safeToken(unit.source)
    };
}

function projectMeta(type, meta, pseudonymize) {
    const source = meta && typeof meta === 'object' ? meta : {};
    if (type === TIMELINE_EVENTS.MULTI_AGENT_ROLLOUT_DECISION) {
        return {
            mode: safeToken(source.mode),
            cohort: safeToken(source.cohort),
            enabled: source.enabled === true,
            applyAcceptedState: source.applyAcceptedState === true,
            participantMemoryEnabled: source.participantMemoryEnabled === true,
            bucket: finiteNumber(source.bucket),
            canaryPercent: finiteNumber(source.canaryPercent)
        };
    }
    if (type === TIMELINE_EVENTS.MULTI_AGENT_EVENT_PUBLISHED) {
        return {
            eventType: safeToken(source.eventType),
            turnIndex: boundedCount(source.turnIndex),
            participantAttributed: source.participantAttributed === true
        };
    }
    if ([
        TIMELINE_EVENTS.MULTI_AGENT_ANALYST_RUN,
        TIMELINE_EVENTS.MULTI_AGENT_ANALYST_RESULT
    ].includes(type)) {
        return {
            analystId: safeToken(source.analystId),
            analystVersion: safeToken(source.analystVersion),
            eventType: safeToken(source.eventType),
            proposalType: safeToken(source.proposalType),
            status: safeToken(source.status),
            reason: safeToken(source.reason),
            durationMs: finiteNumber(source.durationMs),
            model: pseudonymize('model', source.model)
        };
    }
    if (type === TIMELINE_EVENTS.MULTI_AGENT_MEMORY_APPLIED) {
        return {
            memoryRevision: boundedCount(source.memoryRevision),
            participantAttributed: source.participantAttributed === true
        };
    }
    if (type === TIMELINE_EVENTS.PLAYBOOK_NODE_EXIT) {
        return {
            nodeId: pseudonymize('node', source.nodeId),
            failed: source.failed === true,
            skipped: source.skipped === true,
            empty: source.empty === true,
            topicId: pseudonymize('topic', source.topicId),
            claimIds: (source.claimIds ?? []).map((id) => pseudonymize('claim', id)).filter(Boolean),
            semanticSource: safeToken(source.semanticSource)
        };
    }
    if ([
        TIMELINE_EVENTS.ROUTE_PLANNING_STARTED,
        TIMELINE_EVENTS.ROUTE_PROPOSAL_ACCEPTED,
        TIMELINE_EVENTS.ROUTE_PROPOSAL_REJECTED,
        TIMELINE_EVENTS.ROUTE_PROPOSAL_IGNORED
    ].includes(type)) {
        return {
            planningGeneration: boundedCount(source.planningGeneration),
            baseRevision: boundedCount(source.baseRevision),
            resultingRevision: source.resultingRevision === null
                ? null
                : boundedCount(source.resultingRevision),
            reason: safeToken(source.reason) ?? 'redacted_reason',
            questionId: pseudonymize('question', source.questionId),
            proposedNodeCount: source.proposedNodeCount === null
                ? null
                : boundedCount(source.proposedNodeCount),
            proposedNodeIds: (source.proposedNodeIds ?? [])
                .map((id) => pseudonymize('node', id)).filter(Boolean),
            semanticUnits: (source.semanticUnits ?? [])
                .map((unit) => semanticUnit(unit, pseudonymize)).filter(Boolean),
            reviewStatuses: (source.reviewStatuses ?? []).map(safeToken).filter(Boolean)
        };
    }
    if (type === TIMELINE_EVENTS.DYNAMIC_DEMO_EXECUTION) {
        return {
            event: safeToken(source.event),
            status: safeToken(source.status),
            reason: safeToken(source.reason),
            nodeId: pseudonymize('node', source.nodeId),
            routeRevision: boundedCount(source.routeRevision),
            planningGeneration: boundedCount(source.planningGeneration),
            durationMs: finiteNumber(source.durationMs)
        };
    }
    if (type === TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_STATE_TRANSITION) {
        return {
            eventType: safeToken(source.eventType),
            routeRevision: boundedCount(source.routeRevision),
            planningGeneration: boundedCount(source.planningGeneration),
            phase: safeToken(source.phase),
            activity: safeToken(source.activity),
            planningStatus: safeToken(source.planningStatus),
            nodeId: pseudonymize('node', source.nodeId),
            activeNodeId: pseudonymize('node', source.activeNodeId),
            obligationId: pseudonymize('obligation', source.obligationId),
            obligationStatus: safeToken(source.obligationStatus),
            questionKey: pseudonymize('question_key', source.questionKey),
            questionStatus: safeToken(source.questionStatus),
            factKey: pseudonymize('fact_key', source.factKey),
            memoryTurnIndex: boundedCount(source.memoryTurnIndex),
            memoryTopicCount: boundedCount(source.memoryTopicCount)
        };
    }
    if (type === TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_COMPLETION_BLOCKED) {
        return {
            reason: safeToken(source.reason),
            pendingObligationCount: boundedCount(source.pendingObligationCount),
            openQuestionCount: boundedCount(source.openQuestionCount),
            openConcernCount: boundedCount(source.openConcernCount),
            mode: safeToken(source.mode)
        };
    }
    if (type === TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_ROLLOUT_DECISION) {
        return {
            configuredMode: safeToken(source.configuredMode),
            cohort: safeToken(source.cohort),
            reason: safeToken(source.reason),
            dynamicStateEnabled: source.dynamicStateEnabled === true,
            demoExecutionEligible: source.demoExecutionEligible === true,
            runtimeAuthority: safeToken(source.runtimeAuthority),
            legacyRetirementAllowed: source.legacyRetirementAllowed === true,
            bucket: finiteNumber(source.bucket)
        };
    }
    if (type === TIMELINE_EVENTS.ROUTE_REVIEWED) {
        return {
            middlewareId: pseudonymize('reviewer', source.middlewareId),
            status: safeToken(source.status)
        };
    }
    if (type === TIMELINE_EVENTS.MEMORY_PROMOTION_DECISION) {
        return {
            nodeId: pseudonymize('node', source.nodeId),
            topicId: pseudonymize('topic', source.topicId),
            deliveryIntent: safeToken(source.deliveryIntent),
            target: safeToken(source.target),
            allowed: source.allowed === true,
            reason: safeToken(source.reason),
            enforced: source.enforced === true
        };
    }
    if (type === TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION) {
        return {
            proposalId: pseudonymize('survey_proposal', source.proposalId),
            questionKey: pseudonymize('question_key', source.questionKey),
            purpose: safeToken(source.purpose),
            status: safeToken(source.status),
            reason: safeToken(source.reason),
            channel: safeToken(source.channel),
            routeRevision: boundedCount(source.routeRevision),
            epoch: boundedCount(source.epoch),
            factStatus: safeToken(source.factStatus),
            reviewStatuses: (Array.isArray(source.reviewStatuses) ? source.reviewStatuses : [])
                .map(surveyReviewStatus).filter(Boolean).slice(0, 10)
        };
    }
    if (type === TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG) {
        return {
            enabled: source.enabled === true,
            reason: SURVEY_ACTIVATION_REASONS.has(source.reason) ? source.reason : null,
            cohort: ROLLOUT_COHORTS.has(source.cohort) ? source.cohort : 'unknown',
            configuredFieldCount: boundedCount(source.configuredFieldCount)
        };
    }
    if (type === TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_OBSERVATION) {
        return {
            questionKey: pseudonymize('question_key', source.questionKey),
            status: SHADOW_OBSERVATION_STATUSES.has(source.status)
                ? source.status : 'unavailable',
            factStatus: FACT_STATUSES.has(source.factStatus)
                ? source.factStatus : 'unavailable',
            turnIndex: boundedCount(source.turnIndex)
        };
    }
    if (type === TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_PROPOSAL) {
        return {
            proposalId: pseudonymize('survey_proposal', source.proposalId),
            questionKey: pseudonymize('question_key', source.questionKey),
            status: SHADOW_PROPOSAL_STATUSES.has(source.status)
                ? source.status : 'ignored',
            reason: safeToken(source.reason) ?? 'unknown',
            turnIndex: boundedCount(source.turnIndex)
        };
    }
    if (type === TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE) {
        return {
            event: SURVEY_LIFECYCLE_EVENTS.has(source.event) ? source.event : 'unknown',
            proposalId: pseudonymize('survey_proposal', source.proposalId),
            questionKey: pseudonymize('question_key', source.questionKey),
            answerType: SURVEY_ANSWER_TYPES.has(source.answerType) ? source.answerType : null,
            expiresInMs: source.expiresInMs === undefined
                ? null : Math.min(60000, Math.max(0, finiteNumber(source.expiresInMs, 0)))
        };
    }
    return {
        intentId: pseudonymize('intent', source.intentId),
        status: safeToken(source.status),
        evidenceCount: boundedCount(source.evidenceCount),
        demoTargetCount: boundedCount(source.demoTargetCount),
        knowledgeGapStatus: safeToken(source.knowledgeGapStatus)
    };
}

/**
 * Creates a minimal, non-reversible evaluation fixture. Absolute timestamps,
 * transcript text, URLs, room/agent/product IDs and unknown metadata are never
 * copied. The caller must provide an environment-specific secret salt.
 */
export function sanitizeReplaySession({ sessionId, events = [] }, { salt }) {
    if (typeof salt !== 'string' || salt.length < 16) {
        throw new TypeError('anonymization salt must contain at least 16 characters');
    }
    const pseudonymize = createPseudonymizer(salt);
    const included = events
        .filter((event) => INCLUDED_EVENT_TYPES.has(event?.type))
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const sanitizedEvents = included.map((event, index) => ({
        seq: index + 1,
        t: Math.max(0, Math.round(finiteNumber(event.t, 0) / 100) * 100),
        type: event.type,
        ...(Number.isFinite(event.durationMs)
            ? { durationMs: Math.max(0, Math.round(event.durationMs)) }
            : {}),
        meta: projectMeta(event.type, event.meta, pseudonymize)
    }));

    return {
        schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
        fixtureId: pseudonymize('session', sessionId),
        privacy: {
            allowlistProjection: true,
            opaqueIdsPseudonymized: true,
            absoluteTimestampsRemoved: true,
            freeTextRemoved: true,
            urlsRemoved: true
        },
        sourceEventCount: events.length,
        includedEventCount: sanitizedEvents.length,
        events: sanitizedEvents
    };
}
