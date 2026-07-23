import { context as otelContext, propagation } from '@opentelemetry/api';

/**
 * Extracts the OpenTelemetry context stashed by share-link-sessions.js's
 * `dispatchAgent(..., { metadata: { __traceContext } })` call (Phase 7).
 * `ctx.job.metadata` is the raw JSON string LiveKit hands back verbatim.
 * Falls back to a fresh, disconnected context when metadata is missing or
 * malformed (e.g. a job dispatched manually, outside the normal session flow).
 */
export function extractParentContext(job) {
    try {
        const metadata = job?.metadata ? JSON.parse(job.metadata) : {};
        if (!metadata.__traceContext) return otelContext.active();
        return propagation.extract(otelContext.active(), metadata.__traceContext);
    } catch {
        return otelContext.active();
    }
}
