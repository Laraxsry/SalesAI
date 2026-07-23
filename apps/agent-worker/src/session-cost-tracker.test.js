import { describe, it, expect } from 'vitest';
import { createSessionCostTracker } from './session-cost-tracker.js';

describe('createSessionCostTracker', () => {
    it('accumulates realtime turn cost into the running total', () => {
        const tracker = createSessionCostTracker({ alertThresholdUsd: 1000 });
        tracker.addRealtimeTurn({ inputTokens: 1000, outputTokens: 0 });
        tracker.addRealtimeTurn({ inputTokens: 1000, outputTokens: 0 });
        const { realtimeCostUsd, totalCostUsd } = tracker.snapshot();
        expect(realtimeCostUsd).toBeGreaterThan(0);
        expect(totalCostUsd).toBeCloseTo(realtimeCostUsd);
    });

    it('accumulates vision frame cost and count independently of realtime cost', () => {
        const tracker = createSessionCostTracker({ alertThresholdUsd: 1000 });
        tracker.addVisionFrame();
        tracker.addVisionFrame();
        const { visionFrameCount, visionCostUsd, totalCostUsd } = tracker.snapshot();
        expect(visionFrameCount).toBe(2);
        expect(visionCostUsd).toBeGreaterThan(0);
        expect(totalCostUsd).toBeCloseTo(visionCostUsd);
    });

    it('totalCostUsd is the sum of realtime and vision cost', () => {
        const tracker = createSessionCostTracker({ alertThresholdUsd: 1000 });
        tracker.addRealtimeTurn({ inputTokens: 1000, outputTokens: 0 });
        tracker.addVisionFrame();
        const { realtimeCostUsd, visionCostUsd, totalCostUsd } = tracker.snapshot();
        expect(totalCostUsd).toBeCloseTo(realtimeCostUsd + visionCostUsd);
    });

    it('checkThreshold returns false while under the configured limit', () => {
        const tracker = createSessionCostTracker({ alertThresholdUsd: 1000 });
        tracker.addRealtimeTurn({ inputTokens: 1, outputTokens: 0 });
        expect(tracker.checkThreshold()).toBe(false);
    });

    it('checkThreshold returns true exactly once when the total crosses the limit', () => {
        const tracker = createSessionCostTracker({ alertThresholdUsd: 0.001 });
        tracker.addRealtimeTurn({ inputTokens: 1000, outputTokens: 0 });

        expect(tracker.checkThreshold()).toBe(true);
        expect(tracker.checkThreshold()).toBe(false);
        expect(tracker.checkThreshold()).toBe(false);
    });

    it('does not re-alert after more cost accumulates past the first crossing', () => {
        const tracker = createSessionCostTracker({ alertThresholdUsd: 0.001 });
        tracker.addRealtimeTurn({ inputTokens: 1000, outputTokens: 0 });
        tracker.checkThreshold();

        tracker.addRealtimeTurn({ inputTokens: 1000, outputTokens: 0 });
        expect(tracker.checkThreshold()).toBe(false);
    });
});
