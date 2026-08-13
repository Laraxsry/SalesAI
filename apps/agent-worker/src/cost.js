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

/**
 * Same idea for the chained (STT -> LLM -> TTS) pipeline, whose per-turn cost
 * the framework reports as three separate metric events with three different
 * billing units: LLM text tokens, transcribed audio minutes, synthesized
 * characters.
 */
const DEFAULT_CHAINED_PRICING_USD = Object.freeze({
    llmInputPer1K: Number(process.env.COST_LLM_INPUT_TEXT_PER_1K ?? 0.00125),
    llmOutputPer1K: Number(process.env.COST_LLM_OUTPUT_TEXT_PER_1K ?? 0.01),
    sttPerMinute: Number(process.env.COST_STT_PER_MINUTE ?? 0.006),
    ttsPer1KChars: Number(process.env.COST_TTS_PER_1K_CHARS ?? 0.015)
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

/**
 * Estimated USD cost of one chained-pipeline step, from whichever of the
 * framework's `stt_metrics` / `llm_metrics` / `tts_metrics` events just fired.
 * Unlike a realtime turn (one event covering the whole exchange), a chained
 * turn bills as several partial events, so callers accumulate rather than
 * treating any single return value as "the cost of this turn".
 *
 * @param {{type:string, promptTokens?:number, promptCachedTokens?:number, completionTokens?:number, audioDurationMs?:number, charactersCount?:number}} metrics
 * @param {typeof DEFAULT_CHAINED_PRICING_USD} [pricing]
 */
export function estimateChainedStepCostUsd(metrics, pricing = DEFAULT_CHAINED_PRICING_USD) {
    switch (metrics.type) {
        case 'llm_metrics':
            return (
                ((metrics.promptTokens ?? 0) / 1000) * pricing.llmInputPer1K +
                ((metrics.completionTokens ?? 0) / 1000) * pricing.llmOutputPer1K
            );
        case 'stt_metrics':
            return ((metrics.audioDurationMs ?? 0) / 60_000) * pricing.sttPerMinute;
        case 'tts_metrics':
            return ((metrics.charactersCount ?? 0) / 1000) * pricing.ttsPer1KChars;
        default:
            return 0;
    }
}

/** Estimated USD cost of one vision (screen-read) API call — a flat per-call rate, no token breakdown available. */
export function estimateVisionCallCostUsd(price = DEFAULT_VISION_CALL_COST_USD) {
    return price;
}
