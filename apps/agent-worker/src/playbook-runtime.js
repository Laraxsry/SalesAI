import { wrapDirective } from '@repo/agent';

/**
 * Drives one session's playbook: navigate → narrate → wait → advance, one
 * node at a time, entirely off events — nothing here polls or sleeps. The
 * mental model: this is the "yönetmen" — the model never sees more than the
 * one instruction it's currently acting on.
 *
 * *** NO CLIENT-SIDE NAVIGATION TIMEOUT — READ BEFORE ADDING ONE BACK ***
 * An earlier version raced `screen.showUrl()` against a timer and moved on
 * with `screenVisible:false` if it didn't resolve in time. That is unsafe
 * given `showUrl` mutates state shared with the model's own tool calls
 * (`isTourActive` in agent.js): racing it doesn't cancel the underlying
 * `tour.open()`, which keeps running and can flip that state true *after*
 * the pump has already moved on — observed live as a node's screen opening
 * 30+ seconds late, well into a *later* node's turn, while the intervening
 * node's `click_element` call reached Playwright's own locator wait (proof
 * `isTourActive` had already gone true underneath it). `showUrl` is now
 * always awaited to its real conclusion; a genuine hang is bounded by
 * Playwright's own launch/navigation timeouts inside `openAt`/`goto`, which
 * correctly reset `isTourActive` in their own catch block on failure —
 * exactly the state hygiene an external race can't provide.
 *
 * *** SINGLE-FLIGHT WARNING ***
 * `pump()` is the only function that ever calls `speak()`. `signal()` (called
 * from a tool handler, mid-turn, or from the silence timer) never speaks — it
 * only marks the cursor and pokes the pump. That split is what makes it safe
 * for a tool call and a timer to both call into this runtime at once: neither
 * path can create two speeches in flight, because only one path is allowed to
 * create any. If a future change makes `signal()` call `speak()` directly,
 * re-read hazard #3/#13 in the playbook plan before doing it.
 *
 * @typedef {import('./playbook-cursor.js').PlaybookNode} PlaybookNode
 *
 * @typedef {object} ScreenPort
 * @property {(url: string) => Promise<{ok: boolean, error?: string}>} showUrl
 * @property {() => Promise<{ok: boolean}>} hideScreen
 *
 * @typedef {object} SpeechHandleLike
 * @property {() => Promise<void>} waitForPlayout
 * @property {boolean} interrupted
 *
 * @param {object} deps
 * @param {ReturnType<import('./playbook-cursor.js').createPlaybookCursor>} deps.cursor
 * @param {ScreenPort} deps.screen
 * @param {(instructions: string) => SpeechHandleLike} deps.speak throws
 *   synchronously if the session isn't running or is closing — the pump's
 *   own try/catch is what turns that into onError + stop(), not the caller
 * @param {(node: PlaybookNode, phase: 'enter'|'redeliver'|'exit'|'failed', meta?: {screenVisible?: boolean, url?: string|null, error?: string, reason?: string}) => void} [deps.onNodeEvent]
 *   `meta.url` is only meaningful when `meta.screenVisible` is true — it is
 *   "what's actually on screen right now" for enter/redeliver/exit, and "the
 *   url that failed to open" (with screenVisible:false) for `failed`.
 * @param {() => void} [deps.onCompleted]
 * @param {(message: string, meta?: object) => void} [deps.onError]
 */
export function createPlaybookRuntime({
    cursor,
    screen,
    speak,
    onNodeEvent = () => { },
    onCompleted = () => { },
    onError = () => { }
}) {
    let stopped = false;
    let dispatching = false;
    let pendingPoke = false;
    let generation = 0;
    let completedFlag = false;

    let lastShownUrl = null;
    /** Node ids whose narration has actually been spoken this session — used
     *  to tell "not yet dispatched" apart from "dispatched, waiting on a
     *  progress signal", and cleared to force a one-time re-delivery. */
    const delivered = new Set();
    /** Node ids that have already used their one re-delivery attempt (see
     *  signal('silence') below) — caps important-step redelivery at exactly
     *  once, so a persistently noisy call still eventually moves on. */
    const redelivered = new Set();
    /** Node ids whose last narration attempt was cut off. Read via
     *  handle.interrupted right after waitForPlayout(); AgentFalseInterruption
     *  is not filtered here yet — that needs the empirical check in the
     *  playbook plan (risk 7.5) before it's worth the added surface. */
    const interruptedIds = new Set();

    async function pump() {
        if (stopped || dispatching) {
            pendingPoke = true;
            return;
        }
        dispatching = true;
        const epoch = ++generation;
        try {
            const node = cursor.current();
            if (!node) {
                if (!completedFlag) {
                    completedFlag = true;
                    onCompleted();
                }
                return;
            }
            if (delivered.has(node.id)) return; // already spoken; waiting on a signal

            // ── 1. NAVIGATE FIRST — the visitor must never hear "look at this"
            // over whatever the previous step left on screen. ──────────────
            let screenVisible = lastShownUrl !== null;
            if (node.url && node.url !== lastShownUrl) {
                const result = await screen.showUrl(node.url);
                if (stopped || generation !== epoch) return;
                if (result?.ok) {
                    lastShownUrl = node.url;
                    screenVisible = true;
                } else {
                    // Never surfaced to the model — it would narrate the
                    // failure. Content still lands, just without a screen.
                    onNodeEvent(node, 'failed', { url: node.url, error: result?.error, screenVisible: false });
                    screenVisible = false;
                }
            } else if (!node.url && lastShownUrl && !cursor.anyRemainingUrl()) {
                await screen.hideScreen();
                if (stopped || generation !== epoch) return;
                lastShownUrl = null;
                screenVisible = false;
            }

            // ── 2. NARRATE — one node's directive, nothing else. ────────────
            const resuming = redelivered.has(node.id);
            // `url` is only meaningful alongside `screenVisible:true` — a
            // stale lastShownUrl can survive a failed navigation (see the
            // `else` branch above), so callers must never show a URL the
            // model wasn't actually narrating in front of.
            onNodeEvent(node, resuming ? 'redeliver' : 'enter', {
                screenVisible,
                url: screenVisible ? lastShownUrl : null
            });

            const handle = speak(wrapDirective(node, { screenVisible, resuming }));
            await handle.waitForPlayout();
            if (stopped || generation !== epoch) return;

            delivered.add(node.id);
            if (handle.interrupted) {
                interruptedIds.add(node.id);
                // Do not mark satisfied and do not redispatch now — talking
                // over whatever the visitor just interrupted for would be
                // worse than the silence it replaced. The next signal()
                // decides what happens (see the 'silence' branch below).
            } else {
                interruptedIds.delete(node.id);
            }
        } catch (err) {
            onError(err.message, { nodeId: cursor.current()?.id });
            stop();
        } finally {
            dispatching = false;
            if (!stopped && pendingPoke) {
                pendingPoke = false;
                queueMicrotask(pump);
            }
        }
    }

    function stop() {
        if (stopped) return;
        stopped = true;
        generation += 1; // invalidates any in-flight await's post-check
    }

    return {
        start() {
            pump();
        },

        /**
         * @param {'tool'|'advance_step'|'silence'|'answered'} kind
         * @param {object} [meta]
         */
        signal(kind, meta) {
            const node = cursor.current();
            if (!node || stopped) return;

            // 'silence' only makes sense once the agent has actually stopped
            // talking — the real caller (silence-driver) already vetoes on
            // `busy`, but that discipline lives in the caller, not here. If a
            // silence signal ever arrives while a node is still mid-dispatch
            // (navigating or narrating), treating it as real would satisfy a
            // node that was never actually finished speaking. 'tool' and
            // 'advance_step' are exempt: those legitimately arrive as part of
            // the very turn that's still playing out (hazard: a tool result
            // or advance_step call from mid-utterance) and must still work.
            if (kind === 'silence' && dispatching) return;

            if (kind === 'silence' && node.mode === 'important' && interruptedIds.has(node.id) && !redelivered.has(node.id)) {
                redelivered.add(node.id);
                delivered.delete(node.id);
                pump();
                return;
            }

            // A skip-if-no-answer node only advances on an explicit answer
            // signal or the ordinary silence/advance_step path below — an
            // 'answered' signal on any other node is an aside, not progress.
            if (kind === 'answered' && node.mode !== 'skip-if-no-answer') return;

            if (!cursor.satisfy(node.id, kind)) return; // already satisfied — idempotent
            // Reports whatever was on screen for this node's own narration —
            // `lastShownUrl` cannot have changed since that node's `pump()`
            // call finished (single-flight: nothing else runs mid-node).
            onNodeEvent(node, 'exit', {
                reason: kind,
                screenVisible: lastShownUrl !== null,
                url: lastShownUrl,
                ...meta
            });
            cursor.advance();
            pump();
        },

        /**
         * Reserved for future use. Interruption bookkeeping is already
         * complete via `handle.interrupted` on the speech that was cut off;
         * inferring an "answer" from the mere fact that the visitor is
         * speaking (rather than from what they actually said) is not
         * reliable enough to act on, so this intentionally does nothing yet.
         */
        noteUserSpeech() { },

        stop,

        get busy() {
            // `dispatching` spans the entire navigate → speak → waitForPlayout
            // window, so it already covers the gap between generateReply()
            // being called and the agent's state actually turning 'speaking'
            // — there is no in-flight window it misses.
            return dispatching;
        },

        get completed() {
            return completedFlag;
        },

        snapshot() {
            return { ...cursor.snapshot(), completed: completedFlag, stopped };
        }
    };
}
