import { openai } from '../openai-client.js';

export class OpenAIProvider {
    constructor() {
        this.model = process.env.OPENAI_LLM_MODEL || 'gpt-5.1';
    }

    /**
     * @param {{ system?: string, messages: Array<{role:string,content:string}>, tools?: any[] }} input
     */
    async complete({ system, messages, tools }) {
        const res = await openai().chat.completions.create({
            model: this.model,
            messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
            tools
        });
        const choice = res.choices[0]?.message;
        return { text: choice?.content || '', toolCalls: choice?.tool_calls || [] };
    }
}
