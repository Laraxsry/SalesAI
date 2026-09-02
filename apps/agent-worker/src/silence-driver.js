/**
 * Fires `onIdle` once the conversation has gone quiet — the agent has finished
 * speaking and the visitor is not speaking either.
 *
 * Why this exists: the agent is otherwise entirely reactive. Its only
 * unprompted moment is the one-shot greeting in `agent.js`; after that a
 * visitor who says nothing gets nothing, forever. A human sales rep fills that
 * silence, and everything the playbook layer later
 * builds on top — advancing to the next presentation step when the model
 * forgets to say it is done — needs exactly this signal.
 *
 * *** Two SDK facts this is built on; changing either breaks it silently ***
 *
 * 1. `AgentState` declares an `'idle'` member but @livekit/agents NEVER emits
 *    it — `_updateAgentState()` only ever passes 'initializing', 'listening',
 *    'thinking' or 'speaking'. Arming on 'idle' produces a timer that is never
 *    set and a driver that never fires, with nothing in the logs to say so.
 *    'listening' is the real quiescent state.
 *
 * 2. `AgentSession` ships its own quiet-detector, `userAwayTimeout` (default
 *    15s), gated on the same agent-listening + user-listening condition. It is
 *    not a substitute: once it fires, the user state becomes 'away' and it does
 *    not re-arm until the next final transcript, so it can fire at most once
 *    per visitor utterance. A visitor who is silent through an eight-step
 *    presentation needs eight fires. Callers should pass `userAwayTimeout: null`
 *    when constructing the session so the two timers don't run on different
 *    clocks against the same silence.
 *
 * *** ONE COUNTER, TWO CALLERS — WHY isCapExempt EXISTS ***
 * `onIdle` is used for two genuinely different things by the same caller
 * (agent.js): advancing a playbook node on silence, and nudging an otherwise-
 * idle visitor once no playbook is running. Both go through the same
 * `consecutive` counter, and it only resets on a final visitor transcript.
 * A visitor who never speaks through a 6-node playbook — the common case for
 * someone passively watching a demo, observed repeatedly in this project's
 * own live testing — burns the budget on node 1-3 alone; from node 4 on,
 * `evaluate()` returns early forever and the driver goes permanently dormant,
 * with no further backstop to move a stuck node along. A "the visitor didn't
 * answer three times, stop pestering them" cap is right for idle chit-chat;
 * it is wrong for a scripted walkthrough, which has no "give up" concept —
 * `isBusy` already tells the difference "still working" from "genuinely
 * quiet"; this tells the difference "presentation is running" from
 * "ordinary conversation", so the budget check can be skipped for the former
 * without touching the underlying counter or its post-playbook meaning.
 *
 * Pure in-memory timing, no I/O — same shape as `realtime-gate.js` and
 * `session-cost-tracker.js`: the caller decides what an idle moment means.
 *
 * @param {object} opts
 * @param {number} opts.idleMs                       quiet window before firing
 * @param {(ctx: { consecutive: number }) => void} opts.onIdle
 * @param {number} [opts.maxConsecutive]             go dormant after this many
 *   unanswered fires, so an absent visitor is not monologued at forever
 * @param {() => boolean} [opts.isBusy]              veto — true while the caller
 *   is mid-work that has not reached the audio pipeline yet (e.g. awaiting a
 *   page navigation), which reads as silence but is not an idle conversation
 * @param {() => boolean} [opts.isCapExempt]          when true, `maxConsecutive`
 *   is not enforced (see the note above) — the counter itself still advances,
 *   so a caller that flips this off again (e.g. once a playbook completes)
 *   sees the accumulated count, not a reset one; call `resetConsecutive()`
 *   explicitly at that transition if a fresh budget is wanted (agent.js does,
 *   on `playbookRuntime`'s `onCompleted`)
 */
export function createSilenceDriver({ idleMs, onIdle, maxConsecutive = 3, isBusy = () => false, isCapExempt = () => false }) {
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    let agentState = 'initializing';
    let userState = 'listening';
    let consecutive = 0;
    let disposed = false;
    // One-shot override for the NEXT armed timer only — set by
    // `expectResponse()` right when the model has just asked something that
    // genuinely needs a real answer (e.g. confirming contact info), so that
    // one wait is long enough for a human to actually respond instead of the
    // normal near-instant self-driven-continuation delay. Consumed (cleared)
    // the moment a timer is armed with it, so it never lingers past the one
    // question it was requested for.
    let nextIdleMsOverride = null;

    function clear() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    /** Quiet means: the agent has nothing left to say, and the visitor isn't
     *  talking. 'away' is the SDK's own long-silence verdict — quieter still,
     *  not activity. */
    function isQuiet() {
        return agentState === 'listening' && userState !== 'speaking';
    }

    function evaluate() {
        if (disposed) return;
        if (consecutive >= maxConsecutive && !isCapExempt()) return;
        if (!isQuiet()) {
            clear();
            return;
        }
        if (timer) return; // already counting down; don't restart the clock
        const waitMs = nextIdleMsOverride ?? idleMs;
        nextIdleMsOverride = null;
        timer = setTimeout(() => {
            timer = null;
            if (disposed || !isQuiet()) return;
            // Busy work (a navigation in flight) looks identical to silence from
            // the audio pipeline's side. Skip this window rather than re-arming
            // immediately, so a slow operation can't produce a burst of fires.
            if (isBusy()) return;
            consecutive += 1;
            onIdle({ consecutive });
        }, waitMs);
    }

    return {
        /** @param {'initializing'|'listening'|'thinking'|'speaking'} state */
        handleAgentState(state) {
            agentState = state;
            evaluate();
        },
        /** @param {'speaking'|'listening'|'away'} state */
        handleUserState(state) {
            userState = state;
            evaluate();
        },
        /** Call on any real sign of life (a final transcript, a playbook step
         *  actually advancing) — the visitor is engaged, so the budget resets. */
        resetConsecutive() {
            consecutive = 0;
            evaluate();
        },
        /**
         * Requests a longer, one-shot wait for the next idle check — call
         * right when the model asks a real question it needs an actual
         * answer to. If a timer is already counting down (still mid-turn,
         * the common case — the model calls this in the same turn as the
         * question), it's cleared and re-armed at `ms` once the turn
         * actually finishes and the driver goes to arm the real wait.
         * @param {number} ms
         */
        expectResponse(ms) {
            nextIdleMsOverride = ms;
            if (timer) {
                clear();
                evaluate();
            }
        },
        dispose() {
            disposed = true;
            clear();
        },
        get armed() {
            return timer !== null;
        }
    };
}
