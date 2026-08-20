import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSilenceDriver } from './silence-driver.js';

/**
 * *** INTERRUPTION WARNING ***
 * The single property that makes a proactive agent tolerable instead of rude is
 * that it never starts talking over someone. That is enforced entirely by which
 * states arm the timer — there is no separate "is anyone talking" check at fire
 * time beyond the same predicate. If a change here makes the "never fires while
 * the agent is speaking" or "user speech disarms" cases fail, do not relax the
 * test: an agent that interrupts its own sentence or the visitor's is worse
 * than one that stays silent, which is the behavior this replaced.
 *
 * Note the states used below are the ones the SDK actually emits. 'idle' is
 * declared in `AgentState` but never emitted — see silence-driver.js.
 */

const IDLE_MS = 12_000;

/** Driver in the steady state the tests care about: agent done, user quiet. */
function quietDriver(overrides = {}) {
    const onIdle = vi.fn();
    const driver = createSilenceDriver({ idleMs: IDLE_MS, onIdle, ...overrides });
    driver.handleUserState('listening');
    driver.handleAgentState('listening');
    return { driver, onIdle };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createSilenceDriver — arming', () => {
    it('does not arm before the agent has finished initializing', () => {
        const onIdle = vi.fn();
        const driver = createSilenceDriver({ idleMs: IDLE_MS, onIdle });
        driver.handleAgentState('initializing');

        expect(driver.armed).toBe(false);
        vi.advanceTimersByTime(IDLE_MS * 2);
        expect(onIdle).not.toHaveBeenCalled();
    });

    it('arms once the agent is listening and fires after the idle window', () => {
        const { driver, onIdle } = quietDriver();

        expect(driver.armed).toBe(true);
        vi.advanceTimersByTime(IDLE_MS - 1);
        expect(onIdle).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onIdle).toHaveBeenCalledTimes(1);
        expect(onIdle).toHaveBeenCalledWith({ consecutive: 1 });
    });

    it('fires exactly once per arm — it does not repeat on its own', () => {
        const { onIdle } = quietDriver();

        vi.advanceTimersByTime(IDLE_MS * 5);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('does not restart the countdown when listening is re-reported', () => {
        // The SDK can emit the same state more than once around tool calls. If
        // each repeat reset the clock, a chatty turn would push the nudge out
        // indefinitely and the driver would effectively never fire.
        const { driver, onIdle } = quietDriver();

        vi.advanceTimersByTime(IDLE_MS - 1000);
        driver.handleAgentState('listening');
        driver.handleUserState('listening');
        vi.advanceTimersByTime(1000);

        expect(onIdle).toHaveBeenCalledTimes(1);
    });
});

describe('createSilenceDriver — never interrupts', () => {
    it('never fires while the agent is speaking', () => {
        const { driver, onIdle } = quietDriver();
        driver.handleAgentState('speaking');

        expect(driver.armed).toBe(false);
        vi.advanceTimersByTime(IDLE_MS * 3);
        expect(onIdle).not.toHaveBeenCalled();
    });

    it('never fires while the agent is thinking', () => {
        const { driver, onIdle } = quietDriver();
        driver.handleAgentState('thinking');

        vi.advanceTimersByTime(IDLE_MS * 3);
        expect(onIdle).not.toHaveBeenCalled();
    });

    it('disarms when the visitor starts speaking', () => {
        const { driver, onIdle } = quietDriver();
        vi.advanceTimersByTime(IDLE_MS - 1);

        driver.handleUserState('speaking');
        expect(driver.armed).toBe(false);

        vi.advanceTimersByTime(IDLE_MS * 3);
        expect(onIdle).not.toHaveBeenCalled();
    });

    it('re-arms from zero after the visitor stops speaking', () => {
        const { driver, onIdle } = quietDriver();
        vi.advanceTimersByTime(IDLE_MS - 1);
        driver.handleUserState('speaking');
        driver.handleUserState('listening');

        // The old countdown must not carry over — a full window from here.
        vi.advanceTimersByTime(IDLE_MS - 1);
        expect(onIdle).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it("counts the SDK's 'away' verdict as quiet, not as activity", () => {
        const onIdle = vi.fn();
        const driver = createSilenceDriver({ idleMs: IDLE_MS, onIdle });
        driver.handleUserState('away');
        driver.handleAgentState('listening');

        vi.advanceTimersByTime(IDLE_MS);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });
});

describe('createSilenceDriver — budget', () => {
    it('stops after maxConsecutive unanswered fires', () => {
        const onIdle = vi.fn();
        const driver = createSilenceDriver({ idleMs: IDLE_MS, onIdle, maxConsecutive: 2 });
        driver.handleUserState('listening');

        // Each fire is followed by the agent speaking then falling back to
        // listening — the real cycle a nudge produces.
        for (let i = 0; i < 5; i += 1) {
            driver.handleAgentState('speaking');
            driver.handleAgentState('listening');
            vi.advanceTimersByTime(IDLE_MS);
        }

        expect(onIdle).toHaveBeenCalledTimes(2);
    });

    it('resetConsecutive revives a dormant driver', () => {
        const onIdle = vi.fn();
        const driver = createSilenceDriver({ idleMs: IDLE_MS, onIdle, maxConsecutive: 1 });
        driver.handleUserState('listening');
        driver.handleAgentState('listening');
        vi.advanceTimersByTime(IDLE_MS);
        expect(onIdle).toHaveBeenCalledTimes(1);

        driver.handleAgentState('speaking');
        driver.handleAgentState('listening');
        vi.advanceTimersByTime(IDLE_MS * 3);
        expect(onIdle).toHaveBeenCalledTimes(1); // dormant

        driver.resetConsecutive();
        vi.advanceTimersByTime(IDLE_MS);
        expect(onIdle).toHaveBeenCalledTimes(2);
    });

    it('reports the consecutive count so the caller can vary its nudge', () => {
        const onIdle = vi.fn();
        const driver = createSilenceDriver({ idleMs: IDLE_MS, onIdle });
        driver.handleUserState('listening');

        for (let i = 0; i < 3; i += 1) {
            driver.handleAgentState('speaking');
            driver.handleAgentState('listening');
            vi.advanceTimersByTime(IDLE_MS);
        }

        expect(onIdle.mock.calls.map(([ctx]) => ctx.consecutive)).toEqual([1, 2, 3]);
    });
});

describe('createSilenceDriver — busy veto', () => {
    it('skips the fire while the caller reports being busy', () => {
        const onIdle = vi.fn();
        let busy = true;
        const driver = createSilenceDriver({ idleMs: IDLE_MS, onIdle, isBusy: () => busy });
        driver.handleUserState('listening');
        driver.handleAgentState('listening');

        vi.advanceTimersByTime(IDLE_MS);
        expect(onIdle).not.toHaveBeenCalled();

        // A skipped window must not burn the budget or leave a timer running —
        // the next genuine return to listening starts a fresh countdown.
        busy = false;
        driver.handleAgentState('speaking');
        driver.handleAgentState('listening');
        vi.advanceTimersByTime(IDLE_MS);
        expect(onIdle).toHaveBeenCalledTimes(1);
        expect(onIdle).toHaveBeenCalledWith({ consecutive: 1 });
    });
});

describe('createSilenceDriver — disposal', () => {
    it('never fires after dispose, even with a countdown in flight', () => {
        const { driver, onIdle } = quietDriver();
        vi.advanceTimersByTime(IDLE_MS - 1);

        driver.dispose();
        expect(driver.armed).toBe(false);

        vi.advanceTimersByTime(IDLE_MS * 3);
        expect(onIdle).not.toHaveBeenCalled();
    });

    it('ignores state changes arriving after dispose', () => {
        const { driver, onIdle } = quietDriver();
        driver.dispose();

        driver.handleAgentState('speaking');
        driver.handleAgentState('listening');
        vi.advanceTimersByTime(IDLE_MS * 3);

        expect(onIdle).not.toHaveBeenCalled();
    });
});
