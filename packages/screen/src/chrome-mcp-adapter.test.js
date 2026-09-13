import { describe, expect, it, vi } from 'vitest';
import { ChromeMcpAdapter } from './chrome-mcp-adapter.js';

function setup({ tools, callResult } = {}) {
    const client = {
        connect: vi.fn(async () => {}),
        listTools: vi.fn(async () => ({
            tools: tools ?? [
                { name: 'click', inputSchema: { type: 'object' } },
                { name: 'evaluate_script', inputSchema: { type: 'object' } }
            ]
        })),
        callTool: vi.fn(async () => callResult ?? ({
            content: [{ type: 'text', text: 'done' }]
        })),
        close: vi.fn(async () => {})
    };
    const transport = { close: vi.fn(async () => {}) };
    const transportFactory = vi.fn(() => transport);
    const adapter = new ChromeMcpAdapter({
        browserUrl: 'http://127.0.0.1:9222',
        clientFactory: () => client,
        transportFactory
    });
    return { adapter, client, transport, transportFactory };
}

describe('ChromeMcpAdapter', () => {
    it('requires either an assigned browser or permission to launch an isolated one', () => {
        expect(() => new ChromeMcpAdapter()).toThrow(/browserUrl or launchBrowser/);
    });

    it('connects to the assigned browser and exposes only allowed tools', async () => {
        const { adapter, transportFactory } = setup();

        await adapter.connect();

        expect(transportFactory).toHaveBeenCalledWith(expect.objectContaining({
            args: expect.arrayContaining([
                '--browser-url=http://127.0.0.1:9222',
                '--no-usage-statistics',
                '--no-performance-crux'
            ])
        }));
        expect(adapter.listTools().map((tool) => tool.name)).toEqual(['click']);
    });

    it('can configure the server to own an isolated headless Chrome', async () => {
        const { adapter, transportFactory } = setup();
        adapter.browserUrl = null;
        adapter.launchBrowser = true;
        adapter.viewport = { width: 1280, height: 720 };

        await adapter.connect();

        expect(transportFactory).toHaveBeenCalledWith(expect.objectContaining({
            args: expect.arrayContaining(['--headless', '--isolated', '--viewport=1280x720'])
        }));
    });

    it('normalizes successful and tool-level error results', async () => {
        const success = setup();
        await expect(success.adapter.callTool('click', { uid: '1' })).resolves.toMatchObject({
            ok: true,
            isError: false
        });

        const failure = setup({ callResult: {
            isError: true,
            content: [{ type: 'text', text: 'not found' }]
        } });
        await expect(failure.adapter.callTool('click', { uid: 'missing' })).resolves.toMatchObject({
            ok: false,
            isError: true
        });
    });

    it('rejects tools outside the allowlist before sending a call', async () => {
        const { adapter, client } = setup();
        await adapter.connect();

        await expect(adapter.callTool('evaluate_script', {})).rejects.toThrow(/not allowed/);
        expect(client.callTool).not.toHaveBeenCalled();
    });

    it('keeps static presentation probes on an internal-only tool surface', async () => {
        const { client, adapter } = setup({
            tools: [{ name: 'click' }, { name: 'evaluate_script' }]
        });
        await adapter.connect();

        expect(adapter.listTools().map((tool) => tool.name)).toEqual(['click']);
        await expect(adapter.callInternalTool('evaluate_script', {
            function: '(el) => el.getBoundingClientRect()', args: ['1_2']
        })).resolves.toMatchObject({ ok: true });
        expect(client.callTool).toHaveBeenCalled();
    });
});
