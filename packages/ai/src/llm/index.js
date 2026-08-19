import { withFallback } from '@repo/resilience';
import { OpenAIProvider } from './openai.provider.js';
import { AnthropicProvider } from './anthropic.provider.js';

const PROVIDER_FACTORIES = {
    openai: () => new OpenAIProvider(),
    anthropic: () => new AnthropicProvider()
};

/**
 * Returns an LLM provider (strategy pattern). All providers expose:
 * complete({ system, messages, tools }) -> { text, toolCalls }.
 *
 * Phase 7: calling `getLLM()` with no argument (the normal case — every
 * caller in this codebase does this) returns a resilient provider that
 * tries `LLM_FALLBACK_CHAIN` in order (default `openai,anthropic`), with
 * per-provider timeout + jittered retry + circuit breaker via
 * `@repo/resilience`. Passing an explicit `name` bypasses the chain
 * entirely and returns that one provider directly — existing/future
 * callers that need one specific provider (e.g. golden-set eval scripts
 * comparing providers) keep working unchanged.
 *
 * `complete()` accepts an optional `timeoutMs` that overrides the per-attempt
 * timeout. The 10s default suits a short conversational turn, but bulk
 * reviewers (the knowledge audit) send several thousand characters and ask for
 * a structured answer about each one — measured at 20s for an eight-chunk
 * group. Under the default those calls are cancelled mid-flight, both
 * providers "fail", and the caller sees a generic
 * "All providers failed for capability llm" with no hint that nothing was
 * actually wrong except the clock.
 *
 * @param {string} [name]
 */
export function getLLM(name) {
    if (name) return PROVIDER_FACTORIES[name]();

    const chain = (process.env.LLM_FALLBACK_CHAIN || 'openai,anthropic').split(',');
    return {
        complete: ({ timeoutMs, ...input }) =>
            withFallback({
                capability: 'llm',
                providers: chain,
                timeoutMs,
                invoke: (providerName) => PROVIDER_FACTORIES[providerName]().complete(input)
            })
    };
}
