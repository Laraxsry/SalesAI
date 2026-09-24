const SAFE_FIELDS = new Set([
    'analystId',
    'analystVersion',
    'eventType',
    'proposalType',
    'status',
    'reason',
    'durationMs',
    'model'
]);

function sanitize(record) {
    return Object.fromEntries(Object.entries(record)
        .filter(([key, value]) => SAFE_FIELDS.has(key)
            && ['string', 'number', 'boolean'].includes(typeof value)));
}

export function createOrchestrationTelemetry({ onRecord = () => {} } = {}) {
    const counters = new Map();

    return Object.freeze({
        record(input) {
            const record = sanitize(input ?? {});
            const key = `${record.analystId ?? 'unknown'}:${record.status ?? 'unknown'}`;
            counters.set(key, (counters.get(key) ?? 0) + 1);
            try {
                onRecord(Object.freeze(record));
            } catch {
                // Observability is never allowed to affect the live call.
            }
        },
        snapshot() {
            return Object.fromEntries(counters);
        }
    });
}
