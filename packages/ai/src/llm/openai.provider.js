import { openai } from '../openai-client.js';

/**
 * Only a model this provider can actually serve may override the default.
 * `complete()` is reached through getLLM()'s fallback chain, so a caller
 * asking for a cheap model by name would otherwise hand an OpenAI model id to
 * Anthropic (or vice versa) the moment the primary provider fails, turning a
 * recoverable outage into a hard 404.
 */
const OPENAI_MODEL = /^(gpt-|o\d|chatgpt-)/;

export class OpenAIProvider {
    constructor() {
        this.model = process.env.OPENAI_LLM_MODEL || 'gpt-5.1';
    }

    /**
     * @param {{ system?: string, messages: Array<{role:string,content:string}>, tools?: any[], model?: string }} input
     *   `model` is a hint: bulk/background work (knowledge audit, ingestion
     *   classification) asks for a cheap model instead of the conversational
     *   default. Ignored when it isn't an OpenAI model id.
     */
    async complete({ system, messages, tools, model }) {
        const res = await openai().chat.completions.create({
            model: model && OPENAI_MODEL.test(model) ? model : this.model,
            messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
            tools
        });
        const choice = res.choices[0]?.message;
        return { text: choice?.content || '', toolCalls: choice?.tool_calls || [] };
    }
}
