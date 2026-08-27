import Anthropic from '@anthropic-ai/sdk';

/** @see OPENAI_MODEL in openai.provider.js — same reasoning, other side of the chain. */
const ANTHROPIC_MODEL = /^claude-/;

export class AnthropicProvider {
    constructor() {
        this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        this.model = process.env.ANTHROPIC_LLM_MODEL || 'claude-sonnet-4-5';
    }

    /**
     * @param {{ system?: string, messages: Array<{role:string,content:string}>, tools?: any[], model?: string }} input
     *   `model` is a hint; ignored when it isn't an Anthropic model id.
     */
    async complete({ system, messages, tools, model }) {
        const res = await this.client.messages.create({
            model: model && ANTHROPIC_MODEL.test(model) ? model : this.model,
            max_tokens: 1024,
            system,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            tools
        });
        const text = res.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
        const toolCalls = res.content.filter((b) => b.type === 'tool_use');
        return { text, toolCalls };
    }
}
