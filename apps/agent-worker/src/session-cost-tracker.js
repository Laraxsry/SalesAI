import { estimateRealtimeTurnCostUsd, estimateVisionCallCostUsd } from './cost.js';

/**
 * Accumulates one session's estimated cost as it happens (Phase 7 — "alert
 * on anomalous per-session cost, runaway tour/vision loops"). Pure
 * bookkeeping, no I/O: callers decide what to do with `checkThreshold()`
 * crossing (log, alert, end the session) and with the final `snapshot()`
 * (publish as a metric, roll into a `UsageRecord`).
 *
 * `checkThreshold()` fires at most once per tracker — a runaway loop calling
 * it every second shouldn't spam the same alert forever.
 *
 * @param {{alertThresholdUsd?:number}} [opts]
 */
export function createSessionCostTracker({
    alertThresholdUsd = Number(process.env.SESSION_COST_ALERT_USD ?? 2)
} = {}) {
    let realtimeCostUsd = 0;
    let visionCostUsd = 0;
    let visionFrameCount = 0;
    let alerted = false;

    function addRealtimeTurn(metrics) {
        const cost = estimateRealtimeTurnCostUsd(metrics);
        realtimeCostUsd += cost;
        return cost;
    }

    function addVisionFrame() {
        const cost = estimateVisionCallCostUsd();
        visionCostUsd += cost;
        visionFrameCount += 1;
        return cost;
    }

    /** True the first time total cost reaches the threshold; false every time after. */
    function checkThreshold() {
        if (alerted) return false;
        const crossed = realtimeCostUsd + visionCostUsd >= alertThresholdUsd;
        if (crossed) alerted = true;
        return crossed;
    }

    function snapshot() {
        return {
            realtimeCostUsd,
            visionCostUsd,
            visionFrameCount,
            totalCostUsd: realtimeCostUsd + visionCostUsd
        };
    }

    return { addRealtimeTurn, addVisionFrame, checkThreshold, snapshot };
}
