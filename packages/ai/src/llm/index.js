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
 * @param {string} [name]
 */
export function getLLM(name) {
    if (name) return PROVIDER_FACTORIES[name]();

    const chain = (process.env.LLM_FALLBACK_CHAIN || 'openai,anthropic').split(',');
    return {
        complete: (input) =>
            withFallback({
                capability: 'llm',
                providers: chain,
                invoke: (providerName) => PROVIDER_FACTORIES[providerName]().complete(input)
            })
    };
}
