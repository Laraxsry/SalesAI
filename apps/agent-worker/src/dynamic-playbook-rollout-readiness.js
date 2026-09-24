export const DEFAULT_DYNAMIC_PLAYBOOK_THRESHOLDS = Object.freeze({
    minSessions: 50,
    minPlanningDecisions: 30,
    maxProposalRejectionRate: 0.15,
    maxStaleProposalRate: 0.05,
    maxDemoFailureRate: 0.10,
    maxCompletionBlockedPerSession: 0.05,
    maxRequiredObligationRejections: 0
});

function sum(reports, select) {
    return reports.reduce((total, report) => total + (select(report) ?? 0), 0);
}

function ratio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : null;
}

export function aggregateDynamicPlaybookReports(reports = []) {
    const decisions = sum(reports, (report) => report.planning.decisions);
    const rejected = sum(reports, (report) => report.planning.rejected);
    const stale = sum(reports, (report) => report.planning.stale);
    const demoAttempts = sum(reports, (report) => report.demo.attempts);
    const demoFailures = sum(reports, (report) => report.demo.failed);
    const completionBlocked = sum(reports, (report) => report.obligations.completionBlocked);
    const requiredObligationRejections = sum(reports, (report) => Object.entries(
        report.planning.rejectionReasons ?? {}
    ).filter(([reason]) => reason.includes('required_obligation'))
        .reduce((total, [, count]) => total + count, 0));
    const semanticComparableSessions = reports.filter((report) =>
        report.shadowComparison?.semanticComparisonAvailable).length;
    const trustedSemanticSessions = reports.filter((report) =>
        report.shadowComparison?.semanticComparisonTrusted).length;
    const legacyTopics = sum(reports, (report) => report.shadowComparison?.topics?.legacy?.length);
    const dynamicTopics = sum(reports, (report) => report.shadowComparison?.topics?.dynamic?.length);
    const matchedTopics = sum(reports, (report) => report.shadowComparison?.topics?.matched?.length);
    const legacyClaims = sum(reports, (report) => report.shadowComparison?.claims?.legacy?.length);
    const dynamicClaims = sum(reports, (report) => report.shadowComparison?.claims?.dynamic?.length);
    const matchedClaims = sum(reports, (report) => report.shadowComparison?.claims?.matched?.length);
    const memoryDecisions = sum(reports, (report) => report.memoryPolicy?.decisions);
    const memoryBlocked = sum(reports, (report) => report.memoryPolicy?.blocked);
    const memoryEnforcedBlocks = sum(reports, (report) => report.memoryPolicy?.enforcedBlocks);
    const adaptiveSurveyDecisions = sum(reports, (report) => report.adaptiveSurveyPolicy?.decisions);
    const adaptiveSurveyApproved = sum(reports, (report) =>
        report.adaptiveSurveyPolicy?.statuses?.approved);
    const adaptiveSurveyRejected = sum(reports, (report) =>
        report.adaptiveSurveyPolicy?.statuses?.rejected);
    const adaptiveSurveyDeferred = sum(reports, (report) =>
        report.adaptiveSurveyPolicy?.statuses?.deferred);

    return {
        sessions: reports.length,
        planningDecisions: decisions,
        proposalRejections: rejected,
        proposalRejectionRate: ratio(rejected, decisions),
        staleProposals: stale,
        staleProposalRate: ratio(stale, decisions),
        demoAttempts,
        demoFailures,
        demoFailureRate: ratio(demoFailures, demoAttempts),
        completionBlocked,
        completionBlockedPerSession: ratio(completionBlocked, reports.length),
        requiredObligationRejections,
        memoryPolicy: {
            decisions: memoryDecisions,
            blocked: memoryBlocked,
            blockRate: ratio(memoryBlocked, memoryDecisions),
            enforcedBlocks: memoryEnforcedBlocks,
            shadowBlocks: memoryBlocked - memoryEnforcedBlocks
        },
        adaptiveSurveyPolicy: {
            decisions: adaptiveSurveyDecisions,
            approved: adaptiveSurveyApproved,
            rejected: adaptiveSurveyRejected,
            deferred: adaptiveSurveyDeferred,
            approvalRate: ratio(adaptiveSurveyApproved, adaptiveSurveyDecisions)
        },
        semanticEvidence: {
            comparableSessions: semanticComparableSessions,
            trustedSessions: trustedSemanticSessions,
            trustedSessionRate: ratio(trustedSemanticSessions, semanticComparableSessions),
            topics: {
                legacy: legacyTopics,
                dynamic: dynamicTopics,
                matched: matchedTopics,
                legacyCoverage: ratio(matchedTopics, legacyTopics),
                dynamicPrecision: ratio(matchedTopics, dynamicTopics)
            },
            claims: {
                legacy: legacyClaims,
                dynamic: dynamicClaims,
                matched: matchedClaims,
                legacyCoverage: ratio(matchedClaims, legacyClaims),
                dynamicPrecision: ratio(matchedClaims, dynamicClaims)
            }
        }
    };
}

/**
 * This gate reports evidence; it does not mutate rollout configuration.
 * Passing it is necessary, never sufficient, for deleting the legacy runtime.
 */
export function evaluateDynamicPlaybookRolloutReadiness(
    aggregate,
    thresholds = DEFAULT_DYNAMIC_PLAYBOOK_THRESHOLDS
) {
    const checks = [
        ['minimum_sessions', aggregate.sessions >= thresholds.minSessions,
            aggregate.sessions, thresholds.minSessions],
        ['minimum_planning_decisions', aggregate.planningDecisions >= thresholds.minPlanningDecisions,
            aggregate.planningDecisions, thresholds.minPlanningDecisions],
        ['proposal_rejection_rate', aggregate.proposalRejectionRate !== null
            && aggregate.proposalRejectionRate <= thresholds.maxProposalRejectionRate,
        aggregate.proposalRejectionRate, thresholds.maxProposalRejectionRate],
        ['stale_proposal_rate', aggregate.staleProposalRate !== null
            && aggregate.staleProposalRate <= thresholds.maxStaleProposalRate,
        aggregate.staleProposalRate, thresholds.maxStaleProposalRate],
        ['demo_failure_rate', aggregate.demoFailureRate !== null
            && aggregate.demoFailureRate <= thresholds.maxDemoFailureRate,
        aggregate.demoFailureRate, thresholds.maxDemoFailureRate],
        ['completion_blocked_per_session', aggregate.completionBlockedPerSession !== null
            && aggregate.completionBlockedPerSession <= thresholds.maxCompletionBlockedPerSession,
        aggregate.completionBlockedPerSession, thresholds.maxCompletionBlockedPerSession],
        ['required_obligation_rejections', aggregate.requiredObligationRejections
            <= thresholds.maxRequiredObligationRejections,
        aggregate.requiredObligationRejections, thresholds.maxRequiredObligationRejections]
    ].map(([id, passed, actual, threshold]) => ({ id, passed, actual, threshold }));

    return {
        ready: checks.every((check) => check.passed),
        legacyRetirementAllowed: false,
        checks,
        blockers: checks.filter((check) => !check.passed).map((check) => check.id),
        note: checks.every((check) => check.passed)
            ? 'Quality evidence passed; explicit migration approval and rollback plan are still required.'
            : 'Legacy runtime must remain active while quality evidence is below threshold.'
    };
}
