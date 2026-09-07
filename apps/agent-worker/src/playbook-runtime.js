import { buildSurveyAcknowledgementInstructions, wrapDirective } from '@repo/agent';

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
 * *** P0 — WHY 'tool'/'advance_step' RESOLVE AGAINST `activeNode`, NOT `cursor.current()` ***
 * `cursor.current()` answers "where is the pointer right now" — a live,
 * mutable read. `advance_step` (the model's own "I've covered this" call)
 * can arrive more than once for what turns out to be the same logical turn
 * — e.g. a duplicated/retried model turn after a transient realtime-session
 * reconnect — and if an earlier one already advanced the cursor before the
 * second is processed, the second one, if it re-read `cursor.current()`,
 * would land on the NEXT node and satisfy it before it was ever dispatched,
 * silently skipping its content (observed live: a node's screen opened but
 * its narration never played — see md/backend/playbook_session_log.md,
 * item 3 / 4.9). `activeNode` is captured once, synchronously, the moment
 * `pump()` begins dispatching a node, and is the fixed reference `signal()`
 * resolves against for 'tool'/'advance_step' — whichever signal arrives
 * first satisfies it; a later one for the same turn is a no-op via
 * `cursor.satisfy()`'s own idempotence, because it resolves to the SAME
 * already-satisfied node instead of accidentally reaching the next one.
 * ('tool' itself currently has no caller — `click_element` succeeding used
 * to trigger it via `withPlaybookProgress`, removed after live testing
 * showed a click landing before any narration happened could close a node
 * that was never actually covered; see md item 6/15. `signal()` still
 * accepts 'tool' so this file doesn't have to change if a real deterministic
 * completion signal is reintroduced later.) `silence`/`answered` are
 * deliberately exempt — those come from a genuinely real-time, independent
 * observer (the silence driver), so "current" correctly means right now for
 * them, not "whatever was active when a signal's origin happened".
 *
 * *** P1 — WHY 'tool'/'advance_step' ALSO REQUIRE `hasSpoken()` ***
 * Identity alone (P0, above) isn't sufficient: live testing across three
 * separate sessions showed the model calling `advance_step` as its very
 * first move on a node — before saying a single word, `handleResponseDone`
 * closing with zero message items, only the tool call. Worse, it compounds:
 * once one node's turn in a session has that "call the tool, say nothing"
 * shape, the model's own prior turns are part of its context, so it tends to
 * repeat exactly that shape for every node after — observed as the SAME
 * leftover sentence from an earlier node resurfacing verbatim 4-6 times
 * across one session, while every later node got skipped unnarrated. See
 * `hasSpoken()` below and md/backend/playbook_session_log.md. A content-less
 * 'tool'/'advance_step' is now ignored entirely — not satisfied, cursor
 * untouched. `pump()`'s own in-flight `waitForPlayout()` still resolves
 * normally right after (the empty generation closes fast) and marks the node
 * `delivered`, same bookkeeping as an interrupted turn, so it isn't left
 * dispatching forever — just waiting on the next legitimate signal (a later,
 * real advance_step, or an eventual 'silence' once the model actually stops).
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
 * @property {Array<{type: string, role?: string}>} [chatItems] SpeechHandle's
 *   own live-updated record of what the turn has produced so far
 *   (message/function_call/function_call_output) — optional in the type only
 *   for defensiveness against a differently-shaped port; see `hasSpoken()`.
 *
 * @param {object} deps
 * @param {ReturnType<import('./playbook-cursor.js').createPlaybookCursor>} deps.cursor
 * @param {ScreenPort} deps.screen
 * @param {{show:(node:PlaybookNode)=>Promise<void>|void, hide:(node:PlaybookNode)=>void}} [deps.survey]
 * @param {(instructions: string) => SpeechHandleLike} deps.speak throws
 *   synchronously if the session isn't running or is closing — the pump's
 *   own try/catch is what turns that into onError + stop(), not the caller
 * @param {string} [deps.languageDisplay] spelled-out agent language (e.g.
 *   "Turkish") threaded into every `wrapDirective()` call — see that
 *   function's doc comment for why this reminder is needed on top of the
 *   system prompt.
 * @param {(node: PlaybookNode, phase: 'enter'|'redeliver'|'exit'|'failed', meta?: {screenVisible?: boolean, url?: string|null, error?: string, reason?: string}) => void} [deps.onNodeEvent]
 *   `meta.url` is only meaningful when `meta.screenVisible` is true — it is
 *   "what's actually on screen right now" for enter/redeliver/exit, and "the
 *   url that failed to open" (with screenVisible:false) for `failed`.
 * @param {() => void} [deps.onCompleted]
 * @param {(message: string, meta?: object) => void} [deps.onError]
 * @param {(node: PlaybookNode, kind: string, reason: string) => void} [deps.onSignalIgnored]
 *   A progress signal was received and deliberately dropped. Exists purely so
 *   that decision is visible: "the model called advance_step but had said
 *   nothing, so the node stayed open" is otherwise indistinguishable from
 *   "the model never called advance_step at all" — and those two have
 *   completely different fixes.
 */
export function createPlaybookRuntime({
    cursor,
    screen,
    survey = { show: () => {}, hide: () => {} },
    speak,
    languageDisplay = null,
    /** What the agent last said out loud, for quoting back on a redelivery.
     *  Defaults to "nothing known", which reproduces the previous wording
     *  exactly — see utterance-memory.js. */
    lastSpoken = () => null,
    onNodeEvent = () => { },
    onCompleted = () => { },
    onError = () => { },
    onSignalIgnored = () => { }
}) {
    let stopped = false;
    let dispatching = false;
    let pendingPoke = false;
    let generation = 0;
    let completedFlag = false;
    /** The node `pump()` is currently (or was most recently) dispatching —
     *  see the P0 note above. Fixed the instant a node is picked up, and
     *  only ever changed by `pump()` itself when it moves to a genuinely
     *  new node — never by `signal()`. */
    let activeNode = null;

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
    /** Node id -> the text that actually made it out before the cut-off.
     *
     *  Captured HERE, at interruption time, and not read from the utterance
     *  memory at redelivery time. A visitor interrupts to ask something; the
     *  redelivery only fires on the next silence, ≥12s later, by which point
     *  the most recent utterance is the ANSWER to that aside. Quoting that
     *  back as "you already said this, continue from there" would make the
     *  repetition worse, not better. */
    const interruptedText = new Map();
    // A UI answer is not part of the realtime model's audio transcript. Keep
    // it for a short serialized acknowledgement and the following node's
    // private instruction, without manufacturing a fake user utterance.
    let pendingSurveyAnswer = null;

    /** The SpeechHandle `pump()` is currently (or was most recently)
     *  dispatching — same lifecycle as `activeNode` (set once, the instant a
     *  node's `speak()` call is made; only ever changed by `pump()` itself).
     *  Exists purely so `signal()` can answer "did this turn actually say
     *  anything" AT THE MOMENT it needs to, via `chatItems` (SpeechHandle's
     *  own public, live-updated record of message/function_call items) —
     *  see the `hasSpoken()` helper below and its comment for why this can't
     *  just be computed once inside `pump()` after the fact. */
    let activeHandle = null;

    /** Real, checkable answer to "did the currently-active node's turn
     *  produce any actual narration" — read fresh every time, not cached,
     *  because for 'advance_step'/'tool' this must be evaluated AT SIGNAL
     *  TIME, while `pump()` may still be awaiting the very same handle's
     *  `waitForPlayout()` (see the P0 note atop this file: those two kinds
     *  are deliberately exempt from the `dispatching` guard, so `signal()`
     *  can run mid-turn). `chatItems` is live-updated as items are produced,
     *  so this is accurate whether the turn is still open or long done. Live
     *  evidence this matters: md/backend/playbook_session_log.md — a session
     *  where `advance_step` closed node 2 ("Çözümlerimizden detaylıca
     *  bahset. 30sn civarı konuş.") in 0.7s with zero spoken content; before
     *  this, spotting that required manually diffing enter/exit timestamps
     *  against the Message collection for a gap with no assistant text. */
    function hasSpoken() {
        return Boolean(activeHandle?.chatItems?.some((item) => item.type === 'message' && item.role === 'assistant'));
    }

    /** Node ids awaiting a forced re-dispatch after being found empty — set by
     *  `requestEmptyRetry()`, consumed by `pump()`'s own delivered-check. Kept
     *  separate from `delivered.delete()` alone because the request and
     *  pump()'s own `delivered.add(node.id)` (from the turn that's BEING
     *  retried) can land in either order: 'followup_suppressed' arrives from
     *  agent.js reacting to an SDK event, mid-flight, exactly like 'tool'/
     *  'advance_step' (see the P0 note). A bare `delivered.delete()` at
     *  request time can be silently overwritten if the in-flight pump() call
     *  hasn't reached its own `delivered.add()` yet; recording the *intent*
     *  here and having pump() honor it whenever it next evaluates that node
     *  is order-independent. */
    const pendingRedeliver = new Set();
    /** Node ids' empty-turn retry counts. Shared by BOTH paths that can
     *  discover a node closing with zero real narration — a suppressed
     *  advance_step follow-up (`signal('followup_suppressed')`) and an
     *  ordinary 'silence' timeout on a node that never said anything (see
     *  P2 below) — one budget per node regardless of which one found it,
     *  not two independent ones that could double a node's total retries. */
    const emptyRetries = new Map();
    const EMPTY_RETRY_CAP = 2;

    /** Requests one more real attempt at the given (already-`delivered`,
     *  never-actually-spoken) node instead of accepting the empty turn as
     *  final. Returns false once the per-node budget is spent, so the caller
     *  falls through to its normal close path — accepted content loss beats
     *  a node stuck retrying forever. */
    function requestEmptyRetry(node) {
        const attempts = (emptyRetries.get(node.id) ?? 0) + 1;
        if (attempts > EMPTY_RETRY_CAP) return false;
        emptyRetries.set(node.id, attempts);
        pendingRedeliver.add(node.id);
        pump();
        return true;
    }

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
            // Receipt comes before navigation, so a visible UI choice feels
            // conversational instead of disappearing into a page-load pause.
            // Keep activeNode on the already-satisfied survey until this
            // handle finishes: even if the model ignores the no-tool rule,
            // an accidental progress signal cannot close the next node.
            if (pendingSurveyAnswer) {
                const acknowledgement = speak(
                    buildSurveyAcknowledgementInstructions(pendingSurveyAnswer, languageDisplay)
                );
                activeHandle = acknowledgement;
                await acknowledgement.waitForPlayout();
                if (stopped || generation !== epoch) return;
            }
            // Fixed here, before anything async happens below — this is the
            // one place `activeNode` is ever assigned. See the P0 note atop
            // this file for why `signal()` must resolve 'tool'/'advance_step'
            // against this instead of re-reading `cursor.current()` later.
            activeNode = node;

            if (delivered.has(node.id)) {
                if (!pendingRedeliver.has(node.id)) return; // already spoken; waiting on a signal
                // A forced retry was requested (see requestEmptyRetry) —
                // consume the request and fall through to dispatch this node
                // again, exactly like a first-time delivery.
                pendingRedeliver.delete(node.id);
                delivered.delete(node.id);
            }

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

            // Survey presentation is a UI side effect, kept behind its own
            // port so this runtime knows nothing about LiveKit or React. Show
            // it before asking the question: the spoken prompt and visible
            // choices must describe the same active node.
            if (node.type === 'survey' && node.survey) {
                await survey.show(node);
                if (stopped || generation !== epoch) return;
                // A fast visitor can answer while the reliable publish awaits.
                // Do not ask a question that has already been completed; let
                // the pending pump dispatch the following node with the answer
                // context instead.
                if (cursor.isSatisfied(node.id)) return;
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

            const handle = speak(
                wrapDirective(node, {
                    screenVisible,
                    resuming,
                    spokenSoFar: resuming ? interruptedText.get(node.id) ?? null : null,
                    languageDisplay,
                    surveyAnswer: pendingSurveyAnswer
                })
            );
            pendingSurveyAnswer = null;
            // Set before the await, not after — see the P0 note and
            // `hasSpoken()`'s comment: 'advance_step'/'tool' can call into
            // `signal()` while this exact await is still pending, and it
            // needs `activeHandle` pointing at THIS turn's handle to answer
            // "did it say anything yet" correctly at that moment.
            activeHandle = handle;
            await handle.waitForPlayout();
            if (stopped || generation !== epoch) return;

            delivered.add(node.id);
            if (handle.interrupted) {
                interruptedIds.add(node.id);
                interruptedText.set(node.id, lastSpoken()?.text ?? null);
                // Do not mark satisfied and do not redispatch now — talking
                // over whatever the visitor just interrupted for would be
                // worse than the silence it replaced. The next signal()
                // decides what happens (see the 'silence' branch below).
            } else {
                interruptedIds.delete(node.id);
                interruptedText.delete(node.id);
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
         * @param {'tool'|'advance_step'|'silence'|'answered'|'followup_suppressed'|'survey_answer'} kind
         * @param {object} [meta]
         */
        signal(kind, meta) {
            if (stopped) return;
            // 'tool'/'advance_step' close out whatever node's turn most
            // recently opened — resolved against the fixed `activeNode`,
            // not the cursor's live position (see the P0 note atop this
            // file). 'silence'/'answered' are real-time observations, so
            // they still ask the cursor what's current right now.
            const node = (kind === 'tool' || kind === 'advance_step' || kind === 'followup_suppressed' || kind === 'survey_answer') ? activeNode : cursor.current();
            if (!node) return;

            // A survey is completed only by its matching UI answer. In
            // particular, the model's habitual advance_step and the generic
            // silence driver must never skip a question that is still on
            // screen. Empty narration retries remain allowed so a provider
            // glitch does not leave a silent card behind.
            if (node.type === 'survey' && kind !== 'survey_answer' && kind !== 'followup_suppressed') {
                if (kind !== 'silence' || hasSpoken() || interruptedIds.has(node.id)) {
                    onSignalIgnored(node, kind, 'survey_waiting_for_answer');
                    return;
                }
            }
            if (kind === 'survey_answer' && node.type !== 'survey') return;

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

            // *** P1 — WHY advance_step/tool REQUIRE hasSpoken() ***
            // Live-observed, three separate sessions (md/backend/
            // playbook_session_log.md): the model calls advance_step as its
            // very first move on a node, before saying a single word —
            // `handleResponseDone` closes with zero message items, only the
            // tool call. Worse, it's self-reinforcing: once one node's turn
            // in this session was "call the tool, say nothing", the model's
            // own prior turns are part of its context, so it tends to repeat
            // exactly that shape for every node after — observed as the
            // SAME leftover sentence from an earlier node re-surfacing
            // verbatim 4-6 times across a single session, while every node
            // after the first got skipped with zero real narration. A
            // content-less advance_step is not a legitimate "I'm done" —
            // ignore it here (do not satisfy, do not advance). pump()'s own
            // in-flight `waitForPlayout()` still resolves normally right
            // after (the empty generation closes fast) and marks the node
            // `delivered`, same bookkeeping as an interrupted turn — so the
            // node isn't left dispatching forever, just waiting on the next
            // legitimate signal (typically an eventual 'silence' once the
            // model actually stops, or a later advance_step once it has
            // actually said something) instead of vanishing unnarrated.
            if ((kind === 'tool' || kind === 'advance_step') && !hasSpoken()) {
                onSignalIgnored(node, kind, 'nothing_spoken');
                return;
            }

            // *** WHY 'followup_suppressed' EXISTS ***
            // agent.js intercepts the SDK's own auto-generated follow-up turn
            // when it would carry no per-turn instructions AND the turn that
            // triggered it only ever called advance_step (see followup-
            // guard.js) — that follow-up is what produced the "same sentence
            // 4-6 times" bug (it has nothing to draw from except whatever was
            // last genuinely said). Interrupting it alone would strand
            // agentState in 'thinking' forever (@livekit/agents only clears
            // that on a completed reply) — so the caller reports it here, and
            // this re-dispatches the SAME node with its real directive via
            // the normal pump() path, which completes a genuine turn and
            // lets the SDK's own state cycle sort itself out. Shares its
            // retry budget with the 'silence' path below on purpose (P2) —
            // it's the same failure ("this node said nothing"), just caught
            // by a different observer.
            if (kind === 'followup_suppressed') {
                if (!requestEmptyRetry(node)) {
                    onSignalIgnored(node, kind, 'empty_retry_cap_reached');
                }
                return;
            }

            if (kind === 'silence' && node.mode === 'important' && interruptedIds.has(node.id) && !redelivered.has(node.id)) {
                redelivered.add(node.id);
                delivered.delete(node.id);
                pump();
                return;
            }

            // *** P2 — WHY 'silence' ALSO REQUIRES hasSpoken() BEFORE CLOSING ***
            // A node timing out into 'silence' having said literally nothing
            // is not "the visitor didn't respond" — the visitor never had
            // anything to respond TO. Silently closing it the same as a
            // normal, narrated node hid this: `empty:true` was logged but
            // never acted on. First occurrence gets the same forced-retry
            // treatment as an empty advance_step; only once the shared budget
            // (see `requestEmptyRetry`) is spent does this fall through to an
            // ordinary close, matching the existing accepted-content-loss
            // precedent for an interrupted situational node above.
            //
            // Deliberately excludes `interruptedIds` — a node the visitor cut
            // off mid-sentence almost certainly said SOMETHING before being
            // interrupted (the real handle's chatItems would show a partial
            // message; the test harness's bare fake doesn't, which is a test
            // fixture gap, not a reason to treat "interrupted" and "never
            // spoke at all" as the same failure). Interrupted nodes already
            // have their own, older, deliberately different handling just
            // above (single redelivery for `important`, accepted content
            // loss for anything else) — P2 must not re-litigate that.
            if (kind === 'silence' && !hasSpoken() && !interruptedIds.has(node.id)) {
                if (requestEmptyRetry(node)) {
                    onSignalIgnored(node, kind, 'nothing_spoken');
                    return;
                }
                onSignalIgnored(node, kind, 'empty_retry_cap_reached');
                // fall through — close anyway, content loss accepted
            }

            // A skip-if-no-answer node only advances on an explicit answer
            // signal or the ordinary silence/advance_step path below — an
            // 'answered' signal on any other node is an aside, not progress.
            if (kind === 'answered' && node.mode !== 'skip-if-no-answer') return;

            if (!cursor.satisfy(node.id, kind)) return; // already satisfied — idempotent
            if (kind === 'survey_answer') {
                pendingSurveyAnswer = typeof meta?.answer === 'string' ? meta.answer : null;
            }
            // Unconditional on node type, not just the 'survey_answer' kind:
            // a survey node can also close via the exhausted-empty-retry
            // fallthrough above (P2, kind 'silence') when the question was
            // never actually narrated. That path never sends 'survey_answer',
            // so gating hide() on the kind left the visitor's card on screen
            // for a node the runtime had already moved past — the next
            // legitimate answer they submitted then failed instantly with
            // "no longer matches the active question" (normalizeSurveyAnswer
            // resolving against the new activeNode). Hiding here instead,
            // keyed only on node.type, covers every path off a survey node.
            if (node.type === 'survey') survey.hide(node);
            // Reports whatever was on screen for this node's own narration —
            // `lastShownUrl` cannot have changed since that node's `pump()`
            // call finished (single-flight: nothing else runs mid-node).
            onNodeEvent(node, 'exit', {
                reason: kind,
                screenVisible: lastShownUrl !== null,
                url: lastShownUrl,
                empty: !hasSpoken(),
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

        /**
         * The single authoritative answer to "which node is this turn about"
         * — external callers (currently agent.js's follow-up suppression)
         * must read this instead of the cursor directly, so an event check and
         * `signal()` itself can never disagree about which node a turn belongs
         * to. See the P0 note atop this file.
         */
        activeNode() {
            return activeNode;
        },

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
