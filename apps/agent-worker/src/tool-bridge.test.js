import { describe, it, expect, vi } from 'vitest';
import { withToolBridge } from './tool-bridge.js';

/** A RunContext whose `filler` behaves like the SDK's: run fn, expose the source. */
function makeCtx() {
    const calls = [];
    return {
        calls,
        filler: vi.fn(async (source, options, fn) => {
            calls.push({ source, options });
            return fn();
        })
    };
}

function makeTools(handler = vi.fn(async () => ({ ok: true }))) {
    return [
        { name: 'search_knowledge', description: 'd', parameters: {}, handler },
        { name: 'click_element', description: 'd', parameters: {}, handler }
    ];
}

const hooks = (over = {}) => ({
    slowTools: ['search_knowledge'],
    buildInstructions: ({ step }) => (step === 0 ? 'bir saniye' : null),
    speak: vi.fn(() => ({ handle: true })),
    ...over
});

describe('withToolBridge', () => {
    it('schedules a bridge for a slow tool and returns the handler result untouched', async () => {
        const handler = vi.fn(async () => ({ ok: true, chunks: 3 }));
        const ctx = makeCtx();
        const [search] = withToolBridge(makeTools(handler), hooks());

        const result = await search.handler({ query: 'fiyat' }, { ctx });

        expect(ctx.filler).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true, chunks: 3 });
        expect(handler).toHaveBeenCalledWith({ query: 'fiyat' }, { ctx });
    });

    // click_element/scroll_page are moves the model makes WHILE it is already
    // talking; a bridge there is the agent narrating its own machinery.
    it('never bridges a tool outside the slow list', async () => {
        const ctx = makeCtx();
        const [, click] = withToolBridge(makeTools(), hooks());

        await click.handler({ selector: 'text=Fiyatlar' }, { ctx });

        expect(ctx.filler).not.toHaveBeenCalled();
    });

    it('passes the configured dwell and cap to the scheduler', async () => {
        const ctx = makeCtx();
        const [search] = withToolBridge(
            makeTools(),
            hooks({ delayMs: 900, intervalMs: 5000, maxSteps: 2 })
        );

        await search.handler({}, { ctx });

        expect(ctx.calls[0].options).toEqual({ delay: 900, interval: 5000, maxSteps: 2 });
    });

    it('omits interval entirely when none is configured, so it fires at most once', async () => {
        const ctx = makeCtx();
        const [search] = withToolBridge(makeTools(), hooks());

        await search.handler({}, { ctx });

        expect(ctx.calls[0].options).not.toHaveProperty('interval');
    });

    it('hands the scheduler a speech handle for the first step', async () => {
        const ctx = makeCtx();
        const speak = vi.fn(() => ({ handle: true }));
        const onBridge = vi.fn();
        const [search] = withToolBridge(makeTools(), hooks({ speak, onBridge }));

        await search.handler({}, { ctx });
        const spoken = ctx.calls[0].source(0);

        expect(speak).toHaveBeenCalledWith('bir saniye');
        expect(spoken).toEqual({ handle: true });
        expect(onBridge).toHaveBeenCalledWith({ tool: 'search_knowledge', step: 0 });
    });

    it('stays quiet when the builder declines the step', async () => {
        const ctx = makeCtx();
        const speak = vi.fn(() => ({ handle: true }));
        const [search] = withToolBridge(makeTools(), hooks({ speak }));

        await search.handler({}, { ctx });

        expect(ctx.calls[0].source(1)).toBeNull();
        expect(speak).not.toHaveBeenCalled();
    });

    // generateReply throws synchronously once the session is closing, and the
    // SDK's scheduler calls the source with no guard.
    it('survives speak() throwing, reports it, and still resolves the tool', async () => {
        const ctx = makeCtx();
        const onError = vi.fn();
        const [search] = withToolBridge(
            makeTools(),
            hooks({
                speak: () => {
                    throw new Error('session is closing');
                },
                onError
            })
        );

        const result = await search.handler({}, { ctx });

        expect(ctx.calls[0].source(0)).toBeNull();
        expect(onError).toHaveBeenCalledWith('session is closing', { tool: 'search_knowledge', step: 0 });
        expect(result).toEqual({ ok: true });
    });

    it('falls through to the plain handler when the SDK has no filler', async () => {
        const handler = vi.fn(async () => ({ ok: true }));
        const [search] = withToolBridge(makeTools(handler), hooks());

        expect(await search.handler({}, { ctx: {} })).toEqual({ ok: true });
        expect(await search.handler({}, undefined)).toEqual({ ok: true });
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('propagates a handler error unchanged', async () => {
        const handler = vi.fn(async () => {
            throw new Error('retrieve failed');
        });
        const ctx = makeCtx();
        const [search] = withToolBridge(makeTools(handler), hooks());

        await expect(search.handler({}, { ctx })).rejects.toThrow('retrieve failed');
    });

    it('leaves name, description and parameters untouched', () => {
        const wrapped = withToolBridge(makeTools(), hooks());
        expect(wrapped.map((t) => t.name)).toEqual(['search_knowledge', 'click_element']);
        expect(wrapped[0].description).toBe('d');
    });
});
