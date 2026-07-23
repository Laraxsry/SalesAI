import { Logger } from '@repo/logger';
import { getBreaker } from './circuit-breaker.js';
import { retryWithJitter } from './retry.js';
import { withTimeout } from './timeout.js';

/**
 * Calls `invoke(providerName)` for the first provider in `providers` whose
 * circuit isn't open, in order, falling through to the next on failure.
 * This is the single entry point @repo/ai, @repo/avatar, and @repo/rag wrap
 * their provider calls in (Phase 7 provider fallback).
 *
 * Per attempt: circuit-breaker check -> timeout -> jittered retry. A
 * provider's breaker state is keyed by `${capability}:${providerName}` in a
 * shared registry (see circuit-breaker.js), so it persists correctly
 * whether this function is called once at module load (LLM, vector store —
 * the chain is static) or freshly on every call (avatar — the chain
 * depends on the specific agent's configured provider).
 *
 * Throws an AggregateError (with every provider's failure) if the whole
 * chain is exhausted.
 *
 * @param {object} opts
 * @param {string} opts.capability - e.g. 'llm', 'avatar', 'vector-store' (breaker namespace + log field)
 * @param {string[]} opts.providers - ordered provider names to try
 * @param {(providerName: string) => Promise<any>} opts.invoke
 * @param {number} [opts.timeoutMs]
 * @param {{ attempts?: number, baseMs?: number, maxMs?: number }} [opts.retry]
 * @param {{ failureThreshold?: number, resetTimeoutMs?: number }} [opts.breaker]
 */
export async function withFallback({
    capability,
    providers,
    invoke,
    timeoutMs = 10_000,
    retry = {},
    breaker = {}
}) {
    const errors = [];

    for (const providerName of providers) {
        const circuit = getBreaker(`${capability}:${providerName}`, breaker);

        if (!circuit.canAttempt()) {
            Logger.warn('provider circuit open, skipping', { capability, provider: providerName });
            errors.push(new Error(`${providerName}: circuit open`));
            continue;
        }

        try {
            const result = await retryWithJitter(() => withTimeout(() => invoke(providerName), timeoutMs), retry);
            circuit.onSuccess();
            return result;
        } catch (err) {
            circuit.onFailure();
            Logger.warn('provider failed, falling back', {
                capability,
                provider: providerName,
                circuitState: circuit.getState(),
                error: err?.message
            });
            errors.push(err);
        }
    }

    throw new AggregateError(errors, `All providers failed for capability "${capability}": ${providers.join(', ')}`);
}
