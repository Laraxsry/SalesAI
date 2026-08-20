import { describe, it, expect, vi } from 'vitest';
import { createPlaybookCursor } from './playbook-cursor.js';
import { createPlaybookRuntime } from './playbook-runtime.js';

/**
 * *** ORDER + ISOLATION WARNING ***
 * These two properties are the entire point of the design (see
 * md/backend/agent_flow.md): the runtime must navigate strictly before it
 * narrates, and each `speak()` call must carry exactly one node's directive —
 * never the whole plan, never a neighboring node's text. If a change here
 * makes either assertion fail, that is the model's plan-leakage / narrate-
 * before-ready risk becoming real, not a test to relax.
 */

function node(id, order, extra = {}) {
    return { id, order, url: null, directive: `TOPIC_${id}`, attach: null, mode: 'situational', ...extra };
}

/** A shared call log both fakes write into, so ordering across them is
 *  directly observable. */
function makeHarness() {
    const log = [];
    const screen = {
        showUrl: vi.fn(async (url) => {
            log.push(`showUrl:${url}`);
            return { ok: true };
        }),
        hideScreen: vi.fn(async () => {
            log.push('hideScreen');
            return { ok: true };
        })
    };

    // waitForPlayout resolves whenever the test calls resolvePlayout(); this
    // lets tests control exactly when a node "finishes speaking".
    let resolvePlayout = () => {};
    let currentInterrupted = false;
    const speak = vi.fn((instructions) => {
        log.push(`speak:${instructions}`);
        return {
            waitForPlayout: () => new Promise((resolve) => { resolvePlayout = resolve; }),
            get interrupted() {
                return currentInterrupted;
            }
        };
    });

    return {
        log,
        screen,
        speak,
        /** Resolves the in-flight waitForPlayout(); flushes microtasks after. */
        async finishSpeaking({ interrupted = false } = {}) {
            currentInterrupted = interrupted;
            resolvePlayout();
            await flush();
            currentInterrupted = false;
        }
    };
}

async function flush() {
    // Drains the microtask queue enough for the pump's chained
    // awaits/finally/queueMicrotask to settle.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('createPlaybookRuntime — order and isolation', () => {
    it('navigates before it narrates for a node with a url', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { url: 'https://salesai.example/landing' })]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();

        expect(h.log).toEqual(['showUrl:https://salesai.example/landing', expect.stringContaining('speak:')]);
    });

    it("a node's instructions contain only its own directive, never a neighbor's", async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();

        const [instructions] = h.speak.mock.calls[0];
        expect(instructions).toContain('TOPIC_a');
        expect(instructions).not.toContain('TOPIC_b');
    });

    it('does not navigate for a url-less node', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();

        expect(h.screen.showUrl).not.toHaveBeenCalled();
        expect(h.speak).toHaveBeenCalledTimes(1);
    });
});

describe('createPlaybookRuntime — advancing', () => {
    it('advances to the next node on advance_step, after playout finishes', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1);

        await h.finishSpeaking();
        runtime.signal('advance_step');
        await flush();

        expect(h.speak).toHaveBeenCalledTimes(2);
        expect(h.speak.mock.calls[1][0]).toContain('TOPIC_b');
    });

    it('advances on a silence signal the same way', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        runtime.signal('silence');
        await flush();

        expect(h.speak).toHaveBeenCalledTimes(2);
    });

    it('calls onCompleted exactly once when the playbook is exhausted, and never speaks again', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1)]);
        const onCompleted = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onCompleted });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        runtime.signal('advance_step');
        await flush();

        expect(onCompleted).toHaveBeenCalledTimes(1);
        expect(runtime.completed).toBe(true);

        // A stray extra signal after completion must not do anything.
        runtime.signal('advance_step');
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1);
        expect(onCompleted).toHaveBeenCalledTimes(1);
    });
});

describe('createPlaybookRuntime — interruption', () => {
    it('does not satisfy an interrupted node, and does not immediately redeliver it', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { mode: 'situational' }), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking({ interrupted: true });

        // Cut off mid-topic: must not have advanced or re-spoken on its own.
        expect(h.speak).toHaveBeenCalledTimes(1);
        expect(cursor.current()?.id).toBe('a');
    });

    it('an important node is re-delivered once after being interrupted, on the next silence', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { mode: 'important' }), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking({ interrupted: true });

        runtime.signal('silence');
        await flush();

        // Re-delivered, not advanced.
        expect(h.speak).toHaveBeenCalledTimes(2);
        expect(cursor.current()?.id).toBe('a');
        expect(h.speak.mock.calls[1][0]).toContain('TOPIC_a');

        // Second interruption on the redelivery: the one-shot budget is
        // spent, so this time silence must advance instead of redelivering.
        await h.finishSpeaking({ interrupted: true });
        runtime.signal('silence');
        await flush();

        expect(cursor.current()?.id).toBe('b');
    });

    it('a situational node that was interrupted simply advances on the next silence (content loss accepted)', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { mode: 'situational' }), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking({ interrupted: true });

        runtime.signal('silence');
        await flush();

        // Straight to b — no redelivery of a's content for a non-important node.
        expect(cursor.current()?.id).toBe('b');
        expect(h.speak).toHaveBeenCalledTimes(2);
        expect(h.speak.mock.calls[1][0]).toContain('TOPIC_b');
        expect(h.speak.mock.calls[1][0]).not.toContain('TOPIC_a');
    });
});

describe('createPlaybookRuntime — signal never speaks directly', () => {
    it('signal() while a speech is in flight does not create a second one', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1);

        // A tool call resolving mid-speech (e.g. click_element while the
        // model is still narrating) must not itself trigger a new speech.
        runtime.signal('tool');
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1);
    });

    it('a silence signal arriving while the next node is mid-dispatch is dropped, not treated as real', async () => {
        // A 'silence' signal can only be genuine once the agent has actually
        // stopped talking. If one arrives while b is still being dispatched —
        // which cannot happen through the real silence-driver (it vetoes on
        // `busy`) but must not corrupt state if it ever does — it must be a
        // no-op rather than satisfying b before it was ever spoken.
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking();

        runtime.signal('advance_step'); // satisfies a, advances to b, dispatches it
        runtime.signal('silence'); // arrives while b is still mid-dispatch — dropped
        await flush();

        expect(h.speak).toHaveBeenCalledTimes(2);
        expect(cursor.current()?.id).toBe('b'); // still on b, not skipped past it

        // b genuinely finishes now; a real silence afterward advances normally.
        await h.finishSpeaking();
        runtime.signal('silence');
        await flush();
        expect(cursor.exhausted).toBe(true);
    });

    it('a progress signal arriving before waitForPlayout resolves still lands on the next node exactly once', async () => {
        // The model can call advance_step as part of the very turn that is
        // still playing out — the signal legitimately arrives before this
        // runtime's own bookkeeping has seen that speech finish. The
        // single-flight pump must not let that create a second speech while
        // the first is still in flight, nor drop the eventual dispatch of
        // whatever comes next.
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1);

        runtime.signal('advance_step'); // 'a' not yet done speaking
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1); // still just the one — b is queued, not dispatched

        await h.finishSpeaking(); // 'a' finishes; the queued poke now runs

        expect(h.speak).toHaveBeenCalledTimes(2);
        expect(cursor.current()?.id).toBe('b');
        expect(h.speak.mock.calls[1][0]).toContain('TOPIC_b');
    });
});

describe('createPlaybookRuntime — screen lifecycle', () => {
    it('does not hide the screen when a later node still needs one', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([
            node('a', 1, { url: 'https://salesai.example/landing' }),
            node('b', 2), // no url — but node c later needs one
            node('c', 3, { url: 'https://salesai.example/reports' })
        ]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        runtime.signal('advance_step'); // -> node b, url-less
        await flush();

        expect(h.screen.hideScreen).not.toHaveBeenCalled();
    });

    it('hides the screen when no remaining node needs one', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([
            node('a', 1, { url: 'https://salesai.example/landing' }),
            node('b', 2) // no url, and nothing after it needs a screen either
        ]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        runtime.signal('advance_step');
        await flush();

        expect(h.screen.hideScreen).toHaveBeenCalledTimes(1);
    });
});

/**
 * The whole point of this metadata: a reader of the transcript (human or
 * log) must be able to tell what the visitor was actually looking at for
 * every node event, without cross-referencing a separate [screen:...] line.
 * `url` is meaningless without `screenVisible:true` next to it — a stale
 * `lastShownUrl` can outlive a failed navigation, so every assertion here
 * checks both fields together, never `url` alone.
 */
describe('createPlaybookRuntime — onNodeEvent screen metadata', () => {
    it('enter reports the url that is actually showing, for a node with one', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { url: 'https://salesai.example/landing' })]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'enter',
            { screenVisible: true, url: 'https://salesai.example/landing' }
        );
    });

    it('enter reports no screen (avatar) for a url-less node', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1)]); // no url
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'enter',
            { screenVisible: false, url: null }
        );
    });

    it('redeliver reports the same screen state as the original enter', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { url: 'https://salesai.example/landing', mode: 'important' })]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();
        await h.finishSpeaking({ interrupted: true });
        runtime.signal('silence'); // triggers the one-shot redelivery
        await flush();

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'redeliver',
            { screenVisible: true, url: 'https://salesai.example/landing' }
        );
    });

    it('exit reports what was actually on screen during that node, not the next node\'s target', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([
            node('a', 1, { url: 'https://salesai.example/landing' }),
            node('b', 2, { url: 'https://salesai.example/reports' })
        ]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        runtime.signal('advance_step');
        await flush();

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'exit',
            expect.objectContaining({ screenVisible: true, url: 'https://salesai.example/landing' })
        );
    });

    it('failed reports the url that did NOT open, with screenVisible false', async () => {
        const h = makeHarness();
        h.screen.showUrl = vi.fn(async () => ({ ok: false, error: 'domain not allowed' }));
        const cursor = createPlaybookCursor([node('a', 1, { url: 'https://untrusted.example/' })]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'failed',
            { url: 'https://untrusted.example/', error: 'domain not allowed', screenVisible: false }
        );
    });
});

describe('createPlaybookRuntime — failure handling', () => {
    it('a failed navigation still narrates the content, without a screen', async () => {
        const h = makeHarness();
        h.screen.showUrl = vi.fn(async () => ({ ok: false, error: 'domain not allowed' }));
        const cursor = createPlaybookCursor([node('a', 1, { url: 'https://untrusted.example/' })]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();

        expect(h.speak).toHaveBeenCalledTimes(1);
        expect(onNodeEvent).toHaveBeenCalledWith('a' && expect.objectContaining({ id: 'a' }), 'failed', expect.any(Object));
    });

    it('speak() throwing is caught, reported via onError, and stops the runtime', async () => {
        const h = makeHarness();
        const failingSpeak = vi.fn(() => {
            throw new Error('AgentSession is closing, cannot use generateReply()');
        });
        const cursor = createPlaybookCursor([node('a', 1)]);
        const onError = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: failingSpeak, onError });

        runtime.start();
        await flush();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toContain('closing');

        // Stopped: a later signal must not try to speak again.
        runtime.signal('advance_step');
        await flush();
        expect(failingSpeak).toHaveBeenCalledTimes(1);
    });
});

describe('createPlaybookRuntime — stop()', () => {
    it('is idempotent and prevents any further speech once called', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        runtime.stop();
        runtime.stop(); // must not throw or double-invalidate anything

        await h.finishSpeaking();
        runtime.signal('advance_step');
        await flush();

        expect(h.speak).toHaveBeenCalledTimes(1);
    });

    it('a stop() that lands mid-navigation prevents the narration that would have followed', async () => {
        const h = makeHarness();
        let resolveShowUrl;
        h.screen.showUrl = vi.fn(() => new Promise((resolve) => { resolveShowUrl = resolve; }));
        const cursor = createPlaybookCursor([node('a', 1, { url: 'https://salesai.example/landing' })]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        runtime.stop();
        resolveShowUrl({ ok: true });
        await flush();

        expect(h.speak).not.toHaveBeenCalled();
    });
});

describe('createPlaybookRuntime — busy', () => {
    it('is true for the full navigate-through-narrate window and false once idle', async () => {
        const h = makeHarness();
        let resolveShowUrl;
        h.screen.showUrl = vi.fn(() => new Promise((resolve) => { resolveShowUrl = resolve; }));
        const cursor = createPlaybookCursor([node('a', 1, { url: 'https://salesai.example/landing' })]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        expect(runtime.busy).toBe(false);
        runtime.start();
        await flush();
        expect(runtime.busy).toBe(true); // mid-navigation

        resolveShowUrl({ ok: true });
        await flush();
        expect(runtime.busy).toBe(true); // now narrating, awaiting playout

        await h.finishSpeaking();
        expect(runtime.busy).toBe(false);
    });
});
