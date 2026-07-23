import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishMetric } from '@repo/realtime';
import { withToolCallMetrics } from './tool-metrics.js';

vi.mock('@repo/realtime', () => ({
    publishMetric: vi.fn(),
    SESSION_METRICS: { TOOL_CALL_MS: 'tool_call_ms' }
}));

describe('withToolCallMetrics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('preserves the handler return value', async () => {
        const toolDefs = [{ name: 'search_knowledge', handler: async () => ({ ok: true, answer: 42 }) }];
        const [wrapped] = withToolCallMetrics(toolDefs);

        await expect(wrapped.handler({ query: 'x' })).resolves.toEqual({ ok: true, answer: 42 });
    });

    it('forwards all arguments to the original handler', async () => {
        const handler = vi.fn(async (arg) => arg);
        const [wrapped] = withToolCallMetrics([{ name: 'navigate_to', handler }]);

        await wrapped.handler({ url: 'https://example.test' });

        expect(handler).toHaveBeenCalledWith({ url: 'https://example.test' });
    });

    it('publishes a tool_call_ms observation labeled by tool name and ok status on success', async () => {
        const toolDefs = [{ name: 'highlight', handler: async () => ({ ok: true }) }];
        const [wrapped] = withToolCallMetrics(toolDefs);

        await wrapped.handler({ selector: '#cta' });

        expect(publishMetric).toHaveBeenCalledTimes(1);
        const [name, value, labels] = publishMetric.mock.calls[0];
        expect(name).toBe('tool_call_ms');
        expect(value).toBeGreaterThanOrEqual(0);
        expect(labels).toEqual({ tool: 'highlight', status: 'ok' });
    });

    it('still publishes an observation (labeled error) and rethrows when the handler throws', async () => {
        const boom = new Error('boom');
        const toolDefs = [{ name: 'click_element', handler: async () => { throw boom; } }];
        const [wrapped] = withToolCallMetrics(toolDefs);

        await expect(wrapped.handler({ selector: '#x' })).rejects.toThrow('boom');

        expect(publishMetric).toHaveBeenCalledTimes(1);
        const [, , labels] = publishMetric.mock.calls[0];
        expect(labels).toEqual({ tool: 'click_element', status: 'error' });
    });

    it('wraps every tool in the array independently', async () => {
        const toolDefs = [
            { name: 'a', handler: async () => 'a-result' },
            { name: 'b', handler: async () => 'b-result' }
        ];
        const [wrappedA, wrappedB] = withToolCallMetrics(toolDefs);

        await expect(wrappedA.handler()).resolves.toBe('a-result');
        await expect(wrappedB.handler()).resolves.toBe('b-result');
        expect(publishMetric).toHaveBeenCalledTimes(2);
    });
});
