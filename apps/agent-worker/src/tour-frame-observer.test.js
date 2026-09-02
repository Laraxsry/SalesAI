import { describe, it, expect, vi } from 'vitest';
import { TIMELINE_EVENTS } from './session-timeline.js';
import { createTourFrameObserver } from './tour-frame-observer.js';

function makeHarness(initialNow = 0) {
    let clock = initialNow;
    const timeline = { emit: vi.fn() };
    const observer = createTourFrameObserver({ timeline, now: () => clock });
    return {
        observer,
        timeline,
        setNow(value) { clock = value; }
    };
}

describe('createTourFrameObserver', () => {
    it('records the first fresh submitted frame once per navigation', () => {
        const h = makeHarness();
        h.observer.navigationReady({
            url: 'https://product.example/dashboard',
            kind: 'initial',
            navigationStartedAt: 100,
            navigationReadyAt: 500
        });

        const observation = h.observer.frameSubmitted({
            captureStartedAt: 2_000,
            submittedAt: 2_080,
            screenshotMs: 50,
            transformMs: 30,
            submitMs: 1,
            width: 1280,
            height: 720,
            trackSid: 'TR_1'
        });

        expect(observation).toMatchObject({
            navigationId: 1,
            frameSequence: 1,
            readyToFrameMs: 1_580,
            captureQueueMs: 1_500,
            screenshotMs: 50,
            transformMs: 30,
            submitMs: 1
        });
        expect(h.timeline.emit).toHaveBeenCalledWith(
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_SUBMITTED,
            expect.objectContaining({ url: 'https://product.example/dashboard', trackSid: 'TR_1' }),
            1_980
        );

        // Periodic frames after the first one do not create timeline noise.
        h.observer.frameSubmitted({ captureStartedAt: 4_000, submittedAt: 4_050 });
        expect(h.timeline.emit).toHaveBeenCalledTimes(1);
    });

    it('reports a capture that started before readiness as stale and waits for a fresh frame', () => {
        const h = makeHarness();
        h.observer.navigationReady({
            url: 'https://product.example/reports',
            kind: 'navigation',
            navigationStartedAt: 1_000,
            navigationReadyAt: 1_500
        });

        expect(h.observer.frameSubmitted({ captureStartedAt: 1_400, submittedAt: 1_700 })).toBeNull();
        expect(h.timeline.emit).toHaveBeenNthCalledWith(
            1,
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_STALE,
            expect.objectContaining({ captureStartedBeforeReadyMs: 100 }),
            700
        );

        h.observer.frameSubmitted({ captureStartedAt: 2_000, submittedAt: 2_100 });
        expect(h.timeline.emit).toHaveBeenNthCalledWith(
            2,
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_SUBMITTED,
            expect.objectContaining({ frameSequence: 2, readyToFrameMs: 600 }),
            1_100
        );
    });

    it('keeps observing after a recoverable capture failure', () => {
        const h = makeHarness();
        h.observer.navigationReady({
            url: 'https://product.example/risk',
            kind: 'navigation',
            navigationStartedAt: 100,
            navigationReadyAt: 200
        });

        expect(h.observer.frameFailed({
            captureStartedAt: 300,
            failedAt: 350,
            stage: 'screenshot',
            error: 'page closed'
        })).toBe(true);
        expect(h.timeline.emit).toHaveBeenNthCalledWith(
            1,
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_FAILED,
            expect.objectContaining({ stage: 'screenshot', terminal: false }),
            250
        );

        h.observer.frameSubmitted({ captureStartedAt: 1_000, submittedAt: 1_050 });
        expect(h.timeline.emit).toHaveBeenNthCalledWith(
            2,
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_SUBMITTED,
            expect.any(Object),
            950
        );
    });

    it('makes a navigation with no submitted frame visible when superseded or stopped', () => {
        const h = makeHarness();
        h.observer.navigationReady({
            url: 'https://product.example/one',
            kind: 'initial',
            navigationStartedAt: 100,
            navigationReadyAt: 200
        });
        h.observer.navigationReady({
            url: 'https://product.example/two',
            kind: 'navigation',
            navigationStartedAt: 300,
            navigationReadyAt: 400
        });

        expect(h.timeline.emit).toHaveBeenNthCalledWith(
            1,
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_SUPERSEDED,
            expect.objectContaining({ navigationId: 1, supersededByNavigationId: 2 }),
            300
        );

        h.setNow(900);
        expect(h.observer.abandonPending('tour_stopped')).toBe(true);
        expect(h.timeline.emit).toHaveBeenNthCalledWith(
            2,
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_ABANDONED,
            expect.objectContaining({ navigationId: 2, reason: 'tour_stopped', readyWithoutFrameMs: 500 }),
            600
        );
    });

    it('clears a pending observation when track publication fails terminally', () => {
        const h = makeHarness();
        h.observer.navigationReady({
            url: 'https://product.example',
            kind: 'initial',
            navigationStartedAt: 0,
            navigationReadyAt: 100
        });

        h.observer.frameFailed({
            captureStartedAt: 100,
            failedAt: 150,
            stage: 'track_publish',
            error: 'publish failed',
            terminal: true
        });

        expect(h.timeline.emit).toHaveBeenCalledWith(
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_FAILED,
            expect.objectContaining({ stage: 'track_publish', terminal: true }),
            150
        );
        expect(h.observer.abandonPending('tour_stopped')).toBe(false);
    });
});
