import { TIMELINE_EVENTS } from './session-timeline.js';

const STALE_REASONS = new Set([
    'stale_base_revision',
    'stale_planning_generation',
    'superseded_planning_generation'
]);
const TRUSTED_SEMANTIC_SOURCES = new Set(['authored', 'semantic_resolver']);

function ratio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : null;
}

function percentile(values, percentileValue) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

function countBy(items, key) {
    return items.reduce((counts, item) => {
        const value = key(item);
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
    }, {});
}

function unique(values) {
    return [...new Set(values.filter(Boolean))].sort();
}

function compareSemanticSets(legacyValues, dynamicValues) {
    const legacy = unique(legacyValues);
    const dynamic = unique(dynamicValues);
    const legacySet = new Set(legacy);
    const dynamicSet = new Set(dynamic);
    const matched = legacy.filter((value) => dynamicSet.has(value));
    const legacyOnly = legacy.filter((value) => !dynamicSet.has(value));
    const dynamicOnly = dynamic.filter((value) => !legacySet.has(value));
    const unionSize = new Set([...legacy, ...dynamic]).size;
    return {
        legacy,
        dynamic,
        matched,
        legacyOnly,
        dynamicOnly,
        legacyCoverage: legacy.length ? matched.length / legacy.length : null,
        dynamicPrecision: dynamic.length ? matched.length / dynamic.length : null,
        jaccard: unionSize ? matched.length / unionSize : null
    };
}

/** Rebuilds one session's dynamic-playbook quality report without side effects. */
export function evaluateDynamicPlaybookTimeline(events = []) {
    const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const byType = (type) => ordered.filter((event) => event.type === type);
    const started = byType(TIMELINE_EVENTS.ROUTE_PLANNING_STARTED);
    const accepted = byType(TIMELINE_EVENTS.ROUTE_PROPOSAL_ACCEPTED);
    const rejected = byType(TIMELINE_EVENTS.ROUTE_PROPOSAL_REJECTED);
    const ignored = byType(TIMELINE_EVENTS.ROUTE_PROPOSAL_IGNORED);
    const decisions = [...accepted, ...rejected, ...ignored];
    const stale = decisions.filter((event) => STALE_REASONS.has(event.meta?.reason));
    const latencies = decisions
        .map((event) => event.durationMs ?? event.meta?.durationMs)
        .filter(Number.isFinite);
    const demoResults = byType(TIMELINE_EVENTS.DYNAMIC_DEMO_EXECUTION)
        .filter((event) => event.meta?.event === 'result');
    const demoFailures = demoResults.filter((event) => event.meta?.status === 'failed');
    const completionBlocked = byType(TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_COMPLETION_BLOCKED);
    const obligationTransitions = byType(TIMELINE_EVENTS.DYNAMIC_PLAYBOOK_STATE_TRANSITION)
        .filter((event) => event.meta?.eventType === 'OBLIGATION_STATUS_CHANGED');
    const legacyCompletedEvents = byType(TIMELINE_EVENTS.PLAYBOOK_NODE_EXIT)
        .filter((event) => !event.meta?.failed && !event.meta?.skipped);
    const legacyCompletedNodes = legacyCompletedEvents
        .map((event) => event.meta?.nodeId)
        .filter(Boolean);
    const dynamicProposedNodes = accepted
        .flatMap((event) => event.meta?.proposedNodeIds ?? []);
    const legacyTopics = legacyCompletedEvents.map((event) => event.meta?.topicId);
    const legacyClaims = legacyCompletedEvents
        .flatMap((event) => event.meta?.claimIds ?? []);
    const dynamicSemanticUnits = accepted.flatMap((event) => event.meta?.semanticUnits ?? []);
    const dynamicTopics = dynamicSemanticUnits.map((unit) => unit.topicId);
    const dynamicClaims = dynamicSemanticUnits.flatMap((unit) => unit.claimIds ?? []);
    const topicComparison = compareSemanticSets(legacyTopics, dynamicTopics);
    const claimComparison = compareSemanticSets(legacyClaims, dynamicClaims);
    const legacySemanticSources = unique(legacyCompletedEvents
        .map((event) => event.meta?.semanticSource));
    const dynamicSemanticSources = unique(dynamicSemanticUnits.map((unit) => unit.source));
    const trustedLegacyTopics = legacyCompletedEvents.map((event) => event.meta?.topicId);
    const trustedDynamicTopics = dynamicSemanticUnits
        .filter((unit) => TRUSTED_SEMANTIC_SOURCES.has(unit.source))
        .map((unit) => unit.topicId);
    const trustedTopicComparison = compareSemanticSets(
        trustedLegacyTopics,
        trustedDynamicTopics
    );
    const promotionDecisions = byType(TIMELINE_EVENTS.MEMORY_PROMOTION_DECISION);
    const blockedPromotions = promotionDecisions.filter((event) => event.meta?.allowed === false);
    const adaptiveSurveyDecisions = byType(TIMELINE_EVENTS.ADAPTIVE_SURVEY_DECISION);
    const shadowSurveyObservations = byType(TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_OBSERVATION);
    const shadowSurveyProposals = byType(TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_PROPOSAL);
    const surveyConfig = byType(TIMELINE_EVENTS.ADAPTIVE_SURVEY_CONFIG).at(-1)?.meta ?? null;
    const surveyLifecycle = byType(TIMELINE_EVENTS.ADAPTIVE_SURVEY_LIFECYCLE);
    const surveyEvents = (name) => surveyLifecycle.filter((event) => event.meta?.event === name);
    const surveyOpened = surveyEvents('opened');
    const surveyTerminal = surveyLifecycle.filter((event) => [
        'answered', 'dismissed', 'expired', 'customer_interrupted',
        'static_survey_started', 'session_ended'
    ].includes(event.meta?.event));
    const terminalIds = new Set(surveyTerminal.map((event) => event.meta?.proposalId).filter(Boolean));
    const unclosedSurveyCount = surveyOpened.filter((event) =>
        !event.meta?.proposalId || !terminalIds.has(event.meta.proposalId)).length;

    return {
        eventCount: ordered.length,
        planning: {
            started: started.length,
            decisions: decisions.length,
            accepted: accepted.length,
            rejected: rejected.length,
            ignored: ignored.length,
            acceptanceRate: ratio(accepted.length, decisions.length),
            rejectionRate: ratio(rejected.length, decisions.length),
            stale: stale.length,
            staleRate: ratio(stale.length, decisions.length),
            rejectionReasons: countBy(rejected, (event) => event.meta?.reason ?? 'unknown'),
            latencyMs: {
                samples: latencies.length,
                average: latencies.length
                    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
                    : null,
                p95: percentile(latencies, 0.95)
            }
        },
        demo: {
            attempts: demoResults.length,
            completed: demoResults.filter((event) => event.meta?.status === 'completed').length,
            deferred: demoResults.filter((event) => event.meta?.status === 'deferred').length,
            cancelled: demoResults.filter((event) => event.meta?.status === 'cancelled').length,
            failed: demoFailures.length,
            failureRate: ratio(demoFailures.length, demoResults.length)
        },
        obligations: {
            completionBlocked: completionBlocked.length,
            transitions: countBy(obligationTransitions, (event) => event.meta?.obligationStatus ?? 'unknown')
        },
        knowledge: {
            resolved: byType(TIMELINE_EVENTS.KNOWLEDGE_RESOLVED).length,
            notFound: byType(TIMELINE_EVENTS.KNOWLEDGE_NOT_FOUND).length,
            unavailable: byType(TIMELINE_EVENTS.KNOWLEDGE_UNAVAILABLE).length
        },
        memoryPolicy: {
            decisions: promotionDecisions.length,
            allowed: promotionDecisions.filter((event) => event.meta?.allowed === true).length,
            blocked: blockedPromotions.length,
            enforcedBlocks: blockedPromotions.filter((event) => event.meta?.enforced === true).length,
            shadowBlocks: blockedPromotions.filter((event) => event.meta?.enforced !== true).length,
            blockReasons: countBy(blockedPromotions, (event) => event.meta?.reason ?? 'unknown')
        },
        adaptiveSurveyPolicy: {
            decisions: adaptiveSurveyDecisions.length,
            statuses: countBy(adaptiveSurveyDecisions, (event) => event.meta?.status ?? 'unknown'),
            reasons: countBy(adaptiveSurveyDecisions, (event) => event.meta?.reason ?? 'unknown'),
            channels: countBy(adaptiveSurveyDecisions, (event) => event.meta?.channel ?? 'none'),
            reviewerStatuses: countBy(adaptiveSurveyDecisions.flatMap((event) =>
                event.meta?.reviewStatuses ?? []), (status) => status)
        },
        adaptiveSurveyShadow: {
            observations: shadowSurveyObservations.length,
            statuses: countBy(shadowSurveyObservations,
                (event) => event.meta?.status ?? 'unknown'),
            observedFieldCount: unique(shadowSurveyObservations
                .map((event) => event.meta?.questionKey)).length,
            proposals: shadowSurveyProposals.length,
            proposalStatuses: countBy(shadowSurveyProposals,
                (event) => event.meta?.status ?? 'unknown'),
            proposalReasons: countBy(shadowSurveyProposals,
                (event) => event.meta?.reason ?? 'unknown')
        },
        adaptiveSurveyLifecycle: {
            pilotEnabled: surveyConfig?.enabled === true && surveyConfig?.cohort === 'canary',
            cohort: surveyConfig?.cohort ?? null,
            configuredFieldCount: surveyConfig?.configuredFieldCount ?? 0,
            queued: surveyEvents('queued').length,
            opened: surveyOpened.length,
            answered: surveyEvents('answered').length,
            dismissed: surveyEvents('dismissed').length,
            expired: surveyEvents('expired').length,
            interrupted: surveyEvents('customer_interrupted').length,
            publishFailed: surveyEvents('publish_failed').length,
            persistenceFailed: surveyEvents('persistence_failed').length,
            unclosed: unclosedSurveyCount,
            events: countBy(surveyLifecycle, (event) => event.meta?.event ?? 'unknown')
        },
        shadowComparison: {
            legacyCompletedNodeCount: legacyCompletedNodes.length,
            dynamicAcceptedRouteCount: accepted.length,
            dynamicProposedNodeCount: dynamicProposedNodes.length,
            comparisonAvailable: legacyCompletedNodes.length > 0 && accepted.length > 0,
            semanticComparisonAvailable: topicComparison.legacy.length > 0
                && topicComparison.dynamic.length > 0,
            semanticComparisonTrusted: trustedTopicComparison.matched.length > 0,
            semanticSources: {
                legacy: legacySemanticSources,
                dynamic: dynamicSemanticSources
            },
            topics: topicComparison,
            claims: claimComparison,
            trustedTopics: trustedTopicComparison
        }
    };
}
