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
            // Empty by default — tests that need to simulate "the model
            // actually said something" push an assistant message item onto
            // this array (via `speak.mock.results[i].value.chatItems`)
            // before resolving/signaling. Left empty, it reproduces the live
            // bug: a turn whose only output was a tool call.
            chatItems: [],
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
        },
        /** Marks the most recently created handle as having said something —
         *  call before signal('advance_step'/'tool') in any test that isn't
         *  specifically exercising the emptiness gate, to keep exercising
         *  what it exercised before that gate existed (see playbook-runtime.js,
         *  the P1 note on `hasSpoken()`: advance_step/tool are now ignored
         *  unless the node's turn actually produced an assistant message). */
        markSpoken() {
            const last = speak.mock.results[speak.mock.results.length - 1].value;
            last.chatItems.push({ type: 'message', role: 'assistant' });
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
        h.markSpoken();
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
        h.markSpoken();
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

        h.markSpoken();
        runtime.signal('advance_step'); // satisfies a, advances to b, dispatches it
        runtime.signal('silence'); // arrives while b is still mid-dispatch — dropped
        await flush();

        expect(h.speak).toHaveBeenCalledTimes(2);
        expect(cursor.current()?.id).toBe('b'); // still on b, not skipped past it

        // b genuinely finishes now; a real silence afterward advances normally.
        h.markSpoken();
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

        h.markSpoken(); // 'a' already said something in this same, still-open turn
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
        h.markSpoken();
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
        h.markSpoken();
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
        h.markSpoken();
        runtime.signal('advance_step');
        await flush();

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'exit',
            expect.objectContaining({ screenVisible: true, url: 'https://salesai.example/landing' })
        );
    });

    it('marks exit empty:false when the node actually spoke before advance_step closed it', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();
        // Simulate the model having actually said something in this turn
        // before calling advance_step — chatItems is SpeechHandle's own
        // live-updated record, so this is exactly what the real handle would
        // contain by the time the tool call runs.
        h.speak.mock.results[0].value.chatItems.push({ type: 'message', role: 'assistant' });
        runtime.signal('advance_step');
        await flush();

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'exit',
            expect.objectContaining({ reason: 'advance_step', empty: false })
        );
    });

    it('marks exit empty:false for a normal silence-closed node that spoke, and empty:true for one that never got the chance', async () => {
        // Sanity check that this isn't advance_step-specific: any exit path
        // reads the same real signal, because it's the visitor's experience
        // (was anything actually said) that matters, not which mechanism
        // closed the node.
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1)]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();
        h.speak.mock.results[0].value.chatItems.push({ type: 'message', role: 'assistant' });
        await h.finishSpeaking();
        runtime.signal('silence');
        await flush();

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'exit',
            expect.objectContaining({ reason: 'silence', empty: false })
        );
    });

    it('a function_call-only chatItems entry (no assistant message) still counts as empty', async () => {
        // Guards the exact distinction the fix depends on: chatItems
        // contains tool-call bookkeeping too (function_call /
        // function_call_output) — only an actual assistant 'message' item
        // counts as having said something. A node this empty no longer
        // closes on the first 'silence' (see P2 describe block below) — it
        // takes EMPTY_RETRY_CAP retries, each one just as content-less, to
        // exhaust the budget and force a close.
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1)]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();
        for (let i = 0; i < 3; i += 1) {
            h.speak.mock.results[h.speak.mock.results.length - 1].value.chatItems.push(
                { type: 'function_call' },
                { type: 'function_call_output' }
            );
            await h.finishSpeaking();
            runtime.signal('silence'); // retries twice, then closes on the 3rd
            await flush();
        }

        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'exit',
            expect.objectContaining({ empty: true })
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
        expect(onNodeEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'failed',
            expect.any(Object)
        );
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

describe('createPlaybookRuntime — what a redelivery quotes back', () => {
    it('hands the redelivered node the text that was actually cut off', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { mode: 'important' })]);
        const runtime = createPlaybookRuntime({
            cursor,
            screen: h.screen,
            speak: h.speak,
            lastSpoken: () => ({ text: 'Kurumsal pakette SSO ve özel avatar', interrupted: true })
        });

        runtime.start();
        await flush();
        await h.finishSpeaking({ interrupted: true });
        runtime.signal('silence');
        await flush();

        const redelivery = h.log.filter((l) => l.startsWith('speak:')).at(-1);
        expect(redelivery).toContain('Kurumsal pakette SSO ve özel avatar');
        expect(redelivery).toContain('do not start over');
    });

    it('quotes the cut-off narration, not whatever was said answering the aside', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { mode: 'important' })]);
        let spoken = { text: 'KESILEN_ANLATIM', interrupted: true };
        const runtime = createPlaybookRuntime({
            cursor,
            screen: h.screen,
            speak: h.speak,
            lastSpoken: () => spoken
        });

        runtime.start();
        await flush();
        await h.finishSpeaking({ interrupted: true });
        spoken = { text: 'ARADAKI_CEVAP', interrupted: false };
        runtime.signal('silence');
        await flush();

        const redelivery = h.log.filter((l) => l.startsWith('speak:')).at(-1);
        expect(redelivery).toContain('KESILEN_ANLATIM');
        expect(redelivery).not.toContain('ARADAKI_CEVAP');
    });

    it('says nothing about prior text when nothing was captured', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { mode: 'important' })]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking({ interrupted: true });
        runtime.signal('silence');
        await flush();

        const redelivery = h.log.filter((l) => l.startsWith('speak:')).at(-1);
        expect(redelivery).toContain('do not start over');
        expect(redelivery).not.toContain('You already said this');
    });

    it('forgets the cut-off text once the node is narrated cleanly', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1, { mode: 'important' })]);
        const runtime = createPlaybookRuntime({
            cursor,
            screen: h.screen,
            speak: h.speak,
            lastSpoken: () => ({ text: 'ILK_DENEME', interrupted: true })
        });

        runtime.start();
        await flush();
        await h.finishSpeaking({ interrupted: true });
        runtime.signal('silence');
        await flush();
        await h.finishSpeaking({ interrupted: false });

        expect(h.log.filter((l) => l.startsWith('speak:'))).toHaveLength(2);
    });
});

/**
 * *** P0 REGRESSION — DO NOT RELAX WITHOUT RE-READING THE NOTE ATOP playbook-runtime.js ***
 * A node can be closed out through two independent channels in the same
 * turn: a tool result (`signal('tool')`) and the model's own
 * `signal('advance_step')`. Before `activeNode` existed, whichever signal
 * arrived second re-read `cursor.current()` — already advanced by the
 * first — and silently satisfied the WRONG (next, undispatched) node.
 * Observed live: a node's screen opened but its narration never played.
 * These tests fail if that race reopens, in either signal order.
 */
describe('createPlaybookRuntime — P0: activeNode survives a same-turn signal race', () => {
    it('tool then advance_step for the same node: closes exactly that node, never the next one', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2), node('c', 3)]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush(); // 'a' is being spoken; waitForPlayout is still pending
        h.markSpoken(); // 'a' has already said something in this same, still-open turn

        // Both signals arrive back-to-back, mid-utterance — the exact race:
        // a click_element success and the model's own advance_step call in
        // the same turn, before 'a' has finished playing out.
        runtime.signal('tool');
        runtime.signal('advance_step');
        await flush();

        const exited = onNodeEvent.mock.calls.filter(([, phase]) => phase === 'exit').map(([n]) => n.id);
        expect(exited).toEqual(['a']); // NOT ['a', 'b'] — 'b' must still be untouched

        // 'a' finishes speaking; the pump must move on to 'b' next, not 'c'.
        await h.finishSpeaking();
        const spoken = h.log.filter((l) => l.startsWith('speak:'));
        expect(spoken).toEqual([expect.stringContaining('TOPIC_a'), expect.stringContaining('TOPIC_b')]);
    });

    it('the same race in the opposite order (advance_step first, then tool) is equally safe', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();
        h.markSpoken();

        runtime.signal('advance_step');
        runtime.signal('tool');
        await flush();

        const exited = onNodeEvent.mock.calls.filter(([, phase]) => phase === 'exit').map(([n]) => n.id);
        expect(exited).toEqual(['a']);
    });

    it('activeNode() reflects what pump() is actually dispatching, not the cursor\'s post-signal position', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        expect(runtime.activeNode().id).toBe('a');
        h.markSpoken();

        runtime.signal('tool'); // advances the cursor internally; 'a' is still mid-speech
        expect(runtime.activeNode().id).toBe('a'); // unchanged until pump() actually dispatches 'b'

        await h.finishSpeaking();
        expect(runtime.activeNode().id).toBe('b');
    });

    it('a lone advance_step (no competing tool signal) still advances normally — the fix must not break the common case', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await h.finishSpeaking();
        h.markSpoken();
        runtime.signal('advance_step');
        await flush();

        expect(runtime.activeNode().id).toBe('b');
    });
});

/**
 * *** P1 — advance_step/tool require real content, not just a tool call ***
 * Live-observed, three separate sessions (md/backend/playbook_session_log.md):
 * the model calls advance_step as its very first move on a node, before
 * saying a single word — and once that happens once in a session, it tends
 * to repeat the same empty-turn shape for every node after (its own prior
 * turns are part of its context). The fix: an advance_step/tool signal is
 * ignored — not satisfied, cursor untouched — unless the currently active
 * handle's `chatItems` already contains a real assistant message.
 */
describe('createPlaybookRuntime — P1: advance_step is ignored when nothing was actually said', () => {
    it('an advance_step with zero spoken content does not close the node', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();
        // No chatItems pushed — this turn's only output would be the tool call.
        runtime.signal('advance_step');
        await flush();

        expect(onNodeEvent.mock.calls.some(([, phase]) => phase === 'exit')).toBe(false);
        expect(cursor.current()?.id).toBe('a');
        expect(h.speak).toHaveBeenCalledTimes(1); // 'b' never dispatched
    });

    it('once the same still-open turn actually says something, a subsequent advance_step succeeds', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();

        runtime.signal('advance_step'); // premature — ignored
        await flush();
        expect(cursor.current()?.id).toBe('a');

        h.markSpoken(); // the model now actually says something, same turn
        runtime.signal('advance_step'); // legitimate this time
        await flush();

        expect(cursor.current()?.id).toBe('b');
    });

    it('an ignored advance_step still lets the node close eventually, via silence (after the shared retry budget is spent)', async () => {
        // The rejected signal must not strand the node forever — pump()'s
        // own in-flight waitForPlayout still resolves and marks it
        // delivered. 'silence' on a still-empty node retries too (P2), using
        // the SAME budget advance_step's rejection didn't touch, so it takes
        // EMPTY_RETRY_CAP silences (each finding the node still empty) before
        // the final one accepts the content loss and actually closes it.
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        runtime.signal('advance_step'); // ignored, said nothing
        await flush();

        for (let i = 0; i < 3; i += 1) {
            await h.finishSpeaking(); // each empty turn's own generation ends
            runtime.signal('silence'); // retries twice, then closes on the 3rd
            await flush();
        }

        expect(cursor.current()?.id).toBe('b');
    });

    it('does not affect a lone advance_step from a node that spoke normally (no regression)', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        h.markSpoken();
        runtime.signal('advance_step');
        await flush();

        expect(cursor.current()?.id).toBe('b');
        expect(h.speak).toHaveBeenCalledTimes(2);
    });
});

/**
 * *** P2 — 'followup_suppressed' and the shared empty-retry budget ***
 * agent.js catches the SDK's own directive-less auto-follow-up (source
 * 'tool_response', only ever called advance_step in that turn — see
 * followup-guard.js) before it can speak, and reports it here instead of
 * letting it produce a stray, undirected utterance. The runtime's job is to
 * re-dispatch the SAME node with its real directive — a genuine turn that
 * completes normally, so the SDK's own agentState cycle isn't left stranded
 * the way a bare `interrupt()` with nothing to replace it would (observed
 * live: 44s of dead air after a single suppressed advance_step).
 */
describe('createPlaybookRuntime — P2: followup_suppressed redelivers the same node', () => {
    it('re-dispatches the same node without advancing the cursor', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1);

        await h.finishSpeaking(); // the empty (advance_step-only) turn ends
        runtime.signal('followup_suppressed');
        await flush();

        expect(h.speak).toHaveBeenCalledTimes(2); // 'a' redispatched, not 'b'
        expect(h.speak.mock.calls[1][0]).toContain('TOPIC_a');
        expect(cursor.current()?.id).toBe('a'); // cursor never moved
    });

    it('a followup_suppressed signal arriving before the empty turn itself has settled still redelivers once it does', async () => {
        // Realistic ordering in agent.js: the SDK's own auto-follow-up (and
        // our SpeechCreated interception of it) can fire essentially
        // concurrently with — or even before — pump()'s own await on the
        // original (empty) handle resolving. `pendingRedeliver` must survive
        // that ordering, the same way `activeNode`/`activeHandle` already do
        // for 'tool'/'advance_step' (see the P0 note atop this file).
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1);

        runtime.signal('followup_suppressed'); // arrives before 'a' has finished
        await flush();
        expect(h.speak).toHaveBeenCalledTimes(1); // not yet — queued via pendingPoke

        await h.finishSpeaking(); // 'a' finishes; the queued redelivery now runs

        expect(h.speak).toHaveBeenCalledTimes(2);
        expect(h.speak.mock.calls[1][0]).toContain('TOPIC_a');
        expect(cursor.current()?.id).toBe('a');
    });

    it('the redelivered turn is framed as a fresh "enter", never "resuming" (nothing was actually started)', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1)]);
        const onNodeEvent = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onNodeEvent });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        runtime.signal('followup_suppressed');
        await flush();

        const phases = onNodeEvent.mock.calls.map(([, phase]) => phase);
        expect(phases).toEqual(['enter', 'enter']); // not ['enter', 'redeliver']
        expect(h.speak.mock.calls[1][0]).not.toContain('interrupted');
    });

    it('once the node actually speaks, a further followup_suppressed no longer applies (nothing to suppress)', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        runtime.signal('followup_suppressed'); // redelivered
        await flush();

        h.markSpoken(); // this time it actually says something
        await h.finishSpeaking();
        h.markSpoken();
        runtime.signal('advance_step'); // legitimate close now
        await flush();

        expect(cursor.current()?.id).toBe('b');
    });

    it('gives up after EMPTY_RETRY_CAP suppressions and reports it via onSignalIgnored', async () => {
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const onSignalIgnored = vi.fn();
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak, onSignalIgnored });

        runtime.start();
        await flush();
        for (let i = 0; i < 3; i += 1) {
            await h.finishSpeaking();
            runtime.signal('followup_suppressed'); // attempts 1, 2 retried; 3rd exceeds the cap
            await flush();
        }

        expect(h.speak).toHaveBeenCalledTimes(3); // a, a, a — never dispatched b
        expect(cursor.current()?.id).toBe('a'); // still stuck on a — silence must close it
        expect(onSignalIgnored).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' }),
            'followup_suppressed',
            'empty_retry_cap_reached'
        );
    });

    it('shares its retry budget with an empty silence closure on the same node', async () => {
        // The SAME node failing to speak, discovered once via a suppressed
        // follow-up and once via a silent timeout, must not get double the
        // retry budget just because two different observers found it.
        const h = makeHarness();
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        const runtime = createPlaybookRuntime({ cursor, screen: h.screen, speak: h.speak });

        runtime.start();
        await flush();
        await h.finishSpeaking();
        runtime.signal('followup_suppressed'); // attempt 1
        await flush();
        await h.finishSpeaking();
        runtime.signal('silence'); // attempt 2 — same budget, still empty
        await flush();
        await h.finishSpeaking();
        runtime.signal('silence'); // attempt 3 — cap exceeded, closes
        await flush();

        expect(cursor.current()?.id).toBe('b');
    });
});
