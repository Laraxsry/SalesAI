import { describe, it, expect } from 'vitest';
import { estimateRealtimeTurnCostUsd, estimateVisionCallCostUsd } from './cost.js';

const PRICING = { inputText: 0.005, outputText: 0.02, inputAudio: 0.04, outputAudio: 0.08 };

describe('estimateRealtimeTurnCostUsd', () => {
    it('prices each token type from inputTokenDetails/outputTokenDetails independently', () => {
        const metrics = {
            inputTokenDetails: { audioTokens: 1000, textTokens: 1000 },
            outputTokenDetails: { audioTokens: 1000, textTokens: 1000 }
        };
        const cost = estimateRealtimeTurnCostUsd(metrics, PRICING);
        expect(cost).toBeCloseTo(0.005 + 0.04 + 0.02 + 0.08);
    });

    it('falls back to flat inputTokens/outputTokens as text when no breakdown is present', () => {
        const metrics = { inputTokens: 2000, outputTokens: 500 };
        const cost = estimateRealtimeTurnCostUsd(metrics, PRICING);
        expect(cost).toBeCloseTo(2 * 0.005 + 0.5 * 0.02);
    });

    it('returns 0 for a turn with no tokens at all', () => {
        expect(estimateRealtimeTurnCostUsd({}, PRICING)).toBe(0);
    });

    it('uses the default pricing table when none is provided', () => {
        const cost = estimateRealtimeTurnCostUsd({ inputTokens: 1000, outputTokens: 0 });
        expect(cost).toBeGreaterThan(0);
    });
});

describe('estimateVisionCallCostUsd', () => {
    it('returns a flat per-call cost', () => {
        expect(estimateVisionCallCostUsd(0.02)).toBe(0.02);
    });

    it('uses the default price when none is provided', () => {
        expect(estimateVisionCallCostUsd()).toBeGreaterThan(0);
    });
});
