import { OpenAIProvider } from './openai.provider.js';
import { AnthropicProvider } from './anthropic.provider.js';

/**
 * Returns an LLM provider based on LLM_PROVIDER (strategy pattern).
 * All providers expose: complete({ system, messages, tools }) -> { text, toolCalls }.
 * @param {string} [name]
 */
export function getLLM(name = process.env.LLM_PROVIDER || 'openai') {
    switch (name) {
        case 'anthropic':
            return new AnthropicProvider();
        case 'openai':
        default:
            return new OpenAIProvider();
    }
}
