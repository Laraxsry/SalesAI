import { describe, expect, it, vi } from 'vitest';

const create = vi.fn(async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }));
vi.mock('../openai-client.js', () => ({
    openai: () => ({ chat: { completions: { create } } })
}));

import { OpenAIProvider } from './openai.provider.js';

describe('OpenAI LLM provider', () => {
    it('passes an optional structured response format without changing default calls', async () => {
        const provider = new OpenAIProvider();
        const responseFormat = { type: 'json_schema', json_schema: {
            name: 'test', strict: true,
            schema: { type: 'object', additionalProperties: false,
                properties: { ok: { type: 'boolean' } }, required: ['ok'] }
        } };
        await provider.complete({ messages: [{ role: 'user', content: 'test' }],
            responseFormat });
        expect(create.mock.lastCall[0].response_format).toEqual(responseFormat);
        await provider.complete({ messages: [{ role: 'user', content: 'test' }] });
        expect(create.mock.lastCall[0]).not.toHaveProperty('response_format');
    });
});
