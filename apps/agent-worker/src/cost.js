/**
 * Estimated USD pricing for realtime-model tokens and vision calls (Phase 7 —
 * cost tracking). Deliberately approximate and env-overridable rather than
 * hardcoded exactly to a provider's current price sheet: the point is
 * catching a runaway session (a 10x/100x spike), not reconciling to the cent
 * against an invoice — that reconciliation belongs to real billing exports,
 * not a live agent-worker process.
 */
const DEFAULT_REALTIME_PRICING_USD_PER_1K = Object.freeze({
    inputText: Number(process.env.COST_REALTIME_INPUT_TEXT_PER_1K ?? 0.005),
    outputText: Number(process.env.COST_REALTIME_OUTPUT_TEXT_PER_1K ?? 0.02),
    inputAudio: Number(process.env.COST_REALTIME_INPUT_AUDIO_PER_1K ?? 0.04),
    outputAudio: Number(process.env.COST_REALTIME_OUTPUT_AUDIO_PER_1K ?? 0.08)
});

const DEFAULT_VISION_CALL_COST_USD = Number(process.env.COST_VISION_CALL_USD ?? 0.01);

/**
 * Estimated USD cost of one realtime-model turn, from the token breakdown the
 * LiveKit Agents framework already reports on its `MetricsCollected` event
 * (`RealtimeModelMetrics.inputTokenDetails`/`outputTokenDetails`). Falls back
 * to the flat `inputTokens`/`outputTokens` totals (treated as text) when the
 * breakdown is unavailable.
 *
 * @param {{inputTokens?:number, outputTokens?:number, inputTokenDetails?:object, outputTokenDetails?:object}} metrics
 * @param {typeof DEFAULT_REALTIME_PRICING_USD_PER_1K} [pricing]
 */
export function estimateRealtimeTurnCostUsd(metrics, pricing = DEFAULT_REALTIME_PRICING_USD_PER_1K) {
    const inputDetails = metrics.inputTokenDetails || {};
    const outputDetails = metrics.outputTokenDetails || {};

    const inputAudioTokens = inputDetails.audioTokens ?? 0;
    const inputTextTokens = inputDetails.textTokens ?? metrics.inputTokens ?? 0;
    const outputAudioTokens = outputDetails.audioTokens ?? 0;
    const outputTextTokens = outputDetails.textTokens ?? metrics.outputTokens ?? 0;

    return (
        (inputTextTokens / 1000) * pricing.inputText +
        (inputAudioTokens / 1000) * pricing.inputAudio +
        (outputTextTokens / 1000) * pricing.outputText +
        (outputAudioTokens / 1000) * pricing.outputAudio
    );
}

/** Estimated USD cost of one vision (screen-read) API call — a flat per-call rate, no token breakdown available. */
export function estimateVisionCallCostUsd(price = DEFAULT_VISION_CALL_COST_USD) {
    return price;
}
