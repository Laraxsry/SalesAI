/** Descriptive evidence only; field candidates are not survey proposals. */
export function aggregateAdaptiveSurveyShadowReports(reports = []) {
    const seen = new Set();
    const statuses = {};
    let sessions = 0;
    let observations = 0;
    let proposals = 0;
    const proposalStatuses = {};
    for (const report of reports) {
        if (!report.adaptiveSurveyShadow?.observations) continue;
        if (report.sessionId && seen.has(report.sessionId)) continue;
        if (report.sessionId) seen.add(report.sessionId);
        sessions++;
        observations += report.adaptiveSurveyShadow.observations;
        proposals += report.adaptiveSurveyShadow.proposals ?? 0;
        for (const [status, count] of Object.entries(
            report.adaptiveSurveyShadow.statuses ?? {}
        )) {
            statuses[status] = (statuses[status] ?? 0) + count;
        }
        for (const [status, count] of Object.entries(
            report.adaptiveSurveyShadow.proposalStatuses ?? {}
        )) {
            proposalStatuses[status] = (proposalStatuses[status] ?? 0) + count;
        }
    }
    return { sessions, observations, statuses, proposals, proposalStatuses,
        note: 'Rules-based shadow proposals pass structural/policy checks only; customer relevance still requires human review.' };
}
