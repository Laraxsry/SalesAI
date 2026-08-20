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
 */
export function createSilenceDriver({ idleMs, onIdle, maxConsecutive = 3, isBusy = () => false }) {
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    let agentState = 'initializing';
    let userState = 'listening';
    let consecutive = 0;
    let disposed = false;

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
        if (disposed || consecutive >= maxConsecutive) return;
        if (!isQuiet()) {
            clear();
            return;
        }
        if (timer) return; // already counting down; don't restart the clock
        timer = setTimeout(() => {
            timer = null;
            if (disposed || !isQuiet()) return;
            // Busy work (a navigation in flight) looks identical to silence from
            // the audio pipeline's side. Skip this window rather than re-arming
            // immediately, so a slow operation can't produce a burst of fires.
            if (isBusy()) return;
            consecutive += 1;
            onIdle({ consecutive });
        }, idleMs);
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
        dispose() {
            disposed = true;
            clear();
        },
        get armed() {
            return timer !== null;
        }
    };
}
