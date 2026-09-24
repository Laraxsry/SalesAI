export const DEFAULT_ADAPTIVE_SURVEY_THRESHOLDS = Object.freeze({
    minPilotSessions: 20,
    minOpenedSurveys: 10,
    maxPublishFailureRate: 0.05,
    maxPersistenceFailureRate: 0.02,
    maxUnclosedRate: 0
});

function ratio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : null;
}

function sum(reports, key) {
    return reports.reduce((total, report) => total + (report.adaptiveSurveyLifecycle?.[key] ?? 0), 0);
}

function aggregateReviewerSignals(reports) {
    const signals = {};
    for (const report of reports) {
        for (const [status, count] of Object.entries(
            report.adaptiveSurveyPolicy?.reviewerStatuses ?? {}
        )) {
            signals[status] = (signals[status] ?? 0) + count;
        }
    }
    return signals;
}

/** Operational evidence only; customer-fit/false-positive review remains human. */
export function aggregateAdaptiveSurveyReports(reports = []) {
    const seenSessions = new Set();
    const pilot = reports.filter((report) => {
        if (report.adaptiveSurveyLifecycle?.pilotEnabled !== true) return false;
        if (!report.sessionId) return true;
        if (seenSessions.has(report.sessionId)) return false;
        seenSessions.add(report.sessionId);
        return true;
    });
    const opened = sum(pilot, 'opened');
    const answered = sum(pilot, 'answered');
    const dismissed = sum(pilot, 'dismissed');
    const expired = sum(pilot, 'expired');
    const publishFailed = sum(pilot, 'publishFailed');
    const persistenceFailed = sum(pilot, 'persistenceFailed');
    const unclosed = sum(pilot, 'unclosed');
    const interrupted = sum(pilot, 'interrupted');
    return {
        pilotSessions: pilot.length,
        opened, answered, dismissed, expired, interrupted,
        publishFailed, persistenceFailed, unclosed,
        reviewerSignals: aggregateReviewerSignals(pilot),
        answerRate: ratio(answered, opened),
        dismissalRate: ratio(dismissed, opened),
        expiryRate: ratio(expired, opened),
        interruptionRate: ratio(interrupted, opened),
        publishFailureRate: ratio(publishFailed, opened + publishFailed),
        persistenceFailureRate: ratio(persistenceFailed, answered + dismissed + persistenceFailed),
        unclosedRate: ratio(unclosed, opened)
    };
}

/** Never authorizes a rollout change; reports pilot quality evidence. */
export function evaluateAdaptiveSurveyReadiness(
    aggregate,
    thresholds = DEFAULT_ADAPTIVE_SURVEY_THRESHOLDS
) {
    const checks = [
        ['minimum_pilot_sessions', aggregate.pilotSessions >= thresholds.minPilotSessions,
            aggregate.pilotSessions, thresholds.minPilotSessions],
        ['minimum_opened_surveys', aggregate.opened >= thresholds.minOpenedSurveys,
            aggregate.opened, thresholds.minOpenedSurveys],
        ['publish_failure_rate', aggregate.publishFailureRate !== null
            && aggregate.publishFailureRate <= thresholds.maxPublishFailureRate,
        aggregate.publishFailureRate, thresholds.maxPublishFailureRate],
        ['persistence_failure_rate', aggregate.persistenceFailureRate !== null
            && aggregate.persistenceFailureRate <= thresholds.maxPersistenceFailureRate,
        aggregate.persistenceFailureRate, thresholds.maxPersistenceFailureRate],
        ['unclosed_rate', aggregate.unclosedRate !== null
            && aggregate.unclosedRate <= thresholds.maxUnclosedRate,
        aggregate.unclosedRate, thresholds.maxUnclosedRate]
    ].map(([id, passed, actual, threshold]) => ({ id, passed, actual, threshold }));
    return {
        operationalChecksPassed: checks.every((check) => check.passed),
        readyForWiderPilot: false,
        requiresHumanReview: true,
        checks,
        blockers: checks.filter((check) => !check.passed).map((check) => check.id),
        note: 'Operational metrics cannot prove question relevance or customer comfort; review sampled sessions before expanding the pilot.'
    };
}
