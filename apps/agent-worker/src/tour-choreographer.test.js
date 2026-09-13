import { describe, expect, it, vi } from 'vitest';
import { createTourChoreographer } from './tour-choreographer.js';

describe('tour choreographer', () => {
    it('moves, pauses and pulses before a real click', async () => {
        const geometry = { x: 0.2, y: 0.3, width: 0.1, height: 0.05, rects: [] };
        const browser = { describeElement: vi.fn(async () => ({ geometry })) };
        const publishCue = vi.fn(async (cue) => cue);
        const wait = vi.fn(async () => {});
        const choreography = createTourChoreographer({
            browser, publishCue, wait, getViewVersion: () => 7
        });

        await choreography.beforeAction('click', { uid: '2_4' });

        expect(browser.describeElement).toHaveBeenCalledWith('2_4');
        expect(publishCue.mock.calls.map(([cue]) => cue.action)).toEqual(['cursor_move', 'click']);
        expect(publishCue.mock.calls[0][0]).toMatchObject({ viewVersion: 7, target: geometry });
        expect(wait).toHaveBeenCalledTimes(2);
    });

    it('degrades without blocking the browser action when geometry is unavailable', async () => {
        const choreography = createTourChoreographer({
            browser: { describeElement: vi.fn(async () => { throw new Error('stale'); }) },
            publishCue: vi.fn(),
            wait: vi.fn()
        });

        await expect(choreography.beforeAction('click', { uid: 'old' }))
            .resolves.toEqual({ decorated: false });
    });

    it('selects marker presentation for text focus', async () => {
        const publishCue = vi.fn(async (cue) => cue);
        const choreography = createTourChoreographer({
            browser: { describeElement: vi.fn(async () => ({ geometry: { x: 0, y: 0, width: 1, height: 1 } })) },
            publishCue
        });

        await choreography.focus('1_2', 'text');

        expect(publishCue).toHaveBeenCalledWith(expect.objectContaining({ action: 'focus', style: 'marker' }));
    });

    it('shows a directional gesture before keyboard scrolling', async () => {
        const publishCue = vi.fn(async (cue) => cue);
        const choreography = createTourChoreographer({
            browser: { describeElement: vi.fn() },
            publishCue,
            wait: vi.fn(async () => {})
        });

        await choreography.beforeAction('pressKey', { key: 'PageUp' });

        expect(publishCue).toHaveBeenCalledWith(expect.objectContaining({
            action: 'scroll', direction: 'up'
        }));
    });

    it('cancels an action choreography when the customer interrupts', async () => {
        let release;
        const wait = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        const choreography = createTourChoreographer({
            browser: { describeElement: vi.fn(async () => ({ geometry: { x: 0, y: 0, width: 1, height: 1 } })) },
            publishCue: vi.fn(async (cue) => cue),
            wait
        });

        const pending = choreography.beforeAction('click', { uid: '1_2' });
        await vi.waitFor(() => expect(wait).toHaveBeenCalled());
        choreography.cancel();
        release();

        await expect(pending).resolves.toMatchObject({ cancelled: true });
    });
});
