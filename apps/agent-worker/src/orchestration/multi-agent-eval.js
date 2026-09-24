/** PII-free replay summary used by shadow/canary readiness checks. */
export function evaluateMultiAgentRun(records = []) {
    const counts = {};
    const normalized = records.map((record) => record?.meta ?? record ?? {});
    for (const record of normalized) {
        const key = `${record.analystId ?? 'unknown'}:${record.status ?? 'unknown'}`;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    const total = normalized.length;
    const accepted = normalized.filter((record) => record.status === 'accepted').length;
    const failed = normalized.filter((record) => ['error', 'timeout'].includes(record.status)).length;
    const stale = normalized.filter((record) => record.reason === 'stale_turn'
        || record.reason === 'stale_memory_revision').length;
    return Object.freeze({
        total,
        accepted,
        failed,
        stale,
        acceptanceRate: total ? accepted / total : 0,
        failureRate: total ? failed / total : 0,
        counts
    });
}
