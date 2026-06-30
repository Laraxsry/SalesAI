import Anthropic from '@anthropic-ai/sdk';

export class AnthropicProvider {
    constructor() {
        this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        this.model = process.env.ANTHROPIC_LLM_MODEL || 'claude-sonnet-4-5';
    }

    /**
     * @param {{ system?: string, messages: Array<{role:string,content:string}>, tools?: any[] }} input
     */
    async complete({ system, messages, tools }) {
        const res = await this.client.messages.create({
            model: this.model,
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
