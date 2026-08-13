import { describe, it, expect } from 'vitest';
import { estimateChainedStepCostUsd, estimateRealtimeTurnCostUsd, estimateVisionCallCostUsd } from './cost.js';

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

describe('estimateChainedStepCostUsd', () => {
    const CHAINED = { llmInputPer1K: 0.001, llmOutputPer1K: 0.01, sttPerMinute: 0.006, ttsPer1KChars: 0.015 };

    it('prices an llm step from its prompt/completion token counts', () => {
        const cost = estimateChainedStepCostUsd(
            { type: 'llm_metrics', promptTokens: 2000, completionTokens: 500 },
            CHAINED
        );
        expect(cost).toBeCloseTo(2 * 0.001 + 0.5 * 0.01);
    });

    it('prices an stt step per minute of transcribed audio', () => {
        const cost = estimateChainedStepCostUsd({ type: 'stt_metrics', audioDurationMs: 30_000 }, CHAINED);
        expect(cost).toBeCloseTo(0.003);
    });

    it('prices a tts step per synthesized character', () => {
        const cost = estimateChainedStepCostUsd({ type: 'tts_metrics', charactersCount: 500 }, CHAINED);
        expect(cost).toBeCloseTo(0.0075);
    });

    it('returns 0 for metric types that carry no billable unit', () => {
        expect(estimateChainedStepCostUsd({ type: 'eou_metrics' }, CHAINED)).toBe(0);
        expect(estimateChainedStepCostUsd({ type: 'vad_metrics' }, CHAINED)).toBe(0);
    });

    it('treats missing counters as zero rather than NaN', () => {
        expect(estimateChainedStepCostUsd({ type: 'llm_metrics' }, CHAINED)).toBe(0);
        expect(estimateChainedStepCostUsd({ type: 'tts_metrics' }, CHAINED)).toBe(0);
    });

    it('uses the default pricing table when none is provided', () => {
        expect(estimateChainedStepCostUsd({ type: 'tts_metrics', charactersCount: 1000 })).toBeGreaterThan(0);
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
