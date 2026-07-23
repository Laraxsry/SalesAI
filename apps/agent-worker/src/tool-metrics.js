import { publishMetric, SESSION_METRICS } from '@repo/realtime';

/**
 * Wraps each tool's handler to publish its wall-clock duration as a
 * `SESSION_METRICS.TOOL_CALL_MS` observation (Phase 7 — tool-call latency),
 * without altering its return value or error behavior. Labeled by tool name
 * and outcome only (both bounded, known sets) — never by sessionId, which
 * would blow up Prometheus cardinality.
 *
 * @param {Array<{name:string, description:string, parameters:object, handler:Function}>} toolDefs
 * @returns {Array<{name:string, description:string, parameters:object, handler:Function}>}
 */
export function withToolCallMetrics(toolDefs) {
    return toolDefs.map((toolDef) => ({
        ...toolDef,
        handler: async (...args) => {
            const start = Date.now();
            let status = 'ok';
            try {
                return await toolDef.handler(...args);
            } catch (err) {
                status = 'error';
                throw err;
            } finally {
                publishMetric(SESSION_METRICS.TOOL_CALL_MS, Date.now() - start, { tool: toolDef.name, status });
            }
        }
    }));
}
