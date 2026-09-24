function ratio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : null;
}

function percentile(values, percentileValue) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

function distribution(values) {
    const clean = values.filter(Number.isFinite);
    return {
        samples: clean.length,
        average: clean.length
            ? clean.reduce((total, value) => total + value, 0) / clean.length
            : null,
        p10: percentile(clean, 0.10),
        p50: percentile(clean, 0.50),
        p90: percentile(clean, 0.90)
    };
}

/**
 * Produces a review-oriented calibration report, not a production rollout
 * verdict. Threshold selection remains blocked until enough trusted replays
 * exist and human review has examined the candidate mismatches.
 */
export function buildSemanticCalibrationReport(reports = [], {
    minimumComparableSessions = 30,
    minimumTrustedSessions = 20,
    maxReviewQueue = 200
} = {}) {
    const comparable = reports.filter((report) =>
        report.shadowComparison?.semanticComparisonAvailable);
    const trusted = comparable.filter((report) =>
        report.shadowComparison?.semanticComparisonTrusted);
    const reviewQueueCandidates = comparable.flatMap((report) => {
        const comparison = report.shadowComparison;
        const reasons = [];
        if (!comparison.semanticComparisonTrusted) reasons.push('untrusted_identity_only');
        if (comparison.topics.legacyOnly.length > 0) reasons.push('legacy_topics_not_planned');
        if (comparison.topics.dynamicOnly.length > 0) reasons.push('dynamic_topics_not_in_legacy');
        return reasons.length ? [{
            sessionId: report.sessionId,
            reasons,
            legacyOnlyTopicCount: comparison.topics.legacyOnly.length,
            dynamicOnlyTopicCount: comparison.topics.dynamicOnly.length
        }] : [];
    });
    const reviewQueue = reviewQueueCandidates.slice(0, Math.max(0, maxReviewQueue));
    const sourceCounts = comparable.reduce((counts, report) => {
        for (const source of report.shadowComparison.semanticSources?.dynamic ?? []) {
            counts[source] = (counts[source] ?? 0) + 1;
        }
        return counts;
    }, {});
    const enoughComparable = comparable.length >= minimumComparableSessions;
    const enoughTrusted = trusted.length >= minimumTrustedSessions;

    return {
        sessions: {
            total: reports.length,
            comparable: comparable.length,
            trusted: trusted.length,
            comparableRate: ratio(comparable.length, reports.length),
            trustedRate: ratio(trusted.length, comparable.length)
        },
        trustedDistributions: {
            topicLegacyCoverage: distribution(trusted.map((report) =>
                report.shadowComparison.topics.legacyCoverage)),
            topicDynamicPrecision: distribution(trusted.map((report) =>
                report.shadowComparison.topics.dynamicPrecision)),
            topicJaccard: distribution(trusted.map((report) =>
                report.shadowComparison.topics.jaccard)),
            claimLegacyCoverage: distribution(trusted.map((report) =>
                report.shadowComparison.claims.legacyCoverage))
        },
        dynamicSemanticSourceSessions: sourceCounts,
        reviewQueue,
        reviewQueueTruncated: reviewQueue.length < reviewQueueCandidates.length,
        thresholdSelectionReady: enoughComparable && enoughTrusted,
        blockers: [
            ...(!enoughComparable ? ['insufficient_comparable_sessions'] : []),
            ...(!enoughTrusted ? ['insufficient_trusted_sessions'] : [])
        ],
        note: enoughComparable && enoughTrusted
            ? 'Evidence volume is sufficient to propose thresholds; human mismatch review is still required.'
            : 'Collect more trusted replay evidence before selecting production semantic thresholds.'
    };
}
