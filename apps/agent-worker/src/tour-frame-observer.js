import { TIMELINE_EVENTS } from './session-timeline.js';

/**
 * Observes the delivery boundary the worker can prove without changing the
 * media path: a toured page became ready, then a fresh screenshot-derived
 * frame was submitted to LiveKit's local VideoSource.
 *
 * This deliberately does NOT call the event "rendered" or "visible". Network
 * transport, decode and browser paint happen after captureFrame() and require
 * client-side acknowledgement to measure. Keeping that boundary honest makes
 * the trace useful instead of giving a false end-to-end guarantee.
 *
 * One success event is emitted per navigation, not per periodic frame. Failed,
 * stale, superseded and abandoned observations are exceptional diagnostics,
 * so normal sessions gain only a handful of timeline rows.
 *
 * @param {object} deps
 * @param {{emit: Function}} deps.timeline
 * @param {() => number} [deps.now]
 */
export function createTourFrameObserver({ timeline, now = () => Date.now() }) {
    let pendingNavigation = null;
    let navigationSequence = 0;
    let frameSequence = 0;

    function navigationReady({
        url,
        kind,
        navigationStartedAt,
        navigationReadyAt = now()
    }) {
        const navigationId = ++navigationSequence;
        if (pendingNavigation) {
            timeline.emit(
                TIMELINE_EVENTS.SCREEN_TOUR_FRAME_SUPERSEDED,
                {
                    url: pendingNavigation.url,
                    kind: pendingNavigation.kind,
                    navigationId: pendingNavigation.navigationId,
                    supersededByNavigationId: navigationId,
                    readyWithoutFrameMs: Math.max(0, navigationReadyAt - pendingNavigation.navigationReadyAt)
                },
                Math.max(0, navigationReadyAt - pendingNavigation.navigationStartedAt)
            );
        }

        pendingNavigation = {
            url,
            kind,
            navigationId,
            navigationStartedAt,
            navigationReadyAt
        };
        return navigationId;
    }

    function frameSubmitted({
        captureStartedAt,
        submittedAt = now(),
        screenshotMs,
        transformMs,
        submitMs,
        width,
        height,
        trackSid = null
    }) {
        frameSequence += 1;
        const pending = pendingNavigation;
        if (!pending) return null;

        // A capture that began before the new page was ready may contain the
        // previous page even if it was submitted afterwards. Record it, but do
        // not consume the pending navigation; the next fresh frame is the one
        // that proves delivery of the new page.
        if (captureStartedAt < pending.navigationReadyAt) {
            timeline.emit(
                TIMELINE_EVENTS.SCREEN_TOUR_FRAME_STALE,
                {
                    url: pending.url,
                    kind: pending.kind,
                    navigationId: pending.navigationId,
                    frameSequence,
                    captureStartedBeforeReadyMs: pending.navigationReadyAt - captureStartedAt,
                    trackSid
                },
                Math.max(0, submittedAt - pending.navigationStartedAt)
            );
            return null;
        }

        pendingNavigation = null;
        const readyToFrameMs = Math.max(0, submittedAt - pending.navigationReadyAt);
        const endToEndWorkerMs = Math.max(0, submittedAt - pending.navigationStartedAt);
        const observation = {
            url: pending.url,
            kind: pending.kind,
            navigationId: pending.navigationId,
            frameSequence,
            readyToFrameMs,
            captureQueueMs: Math.max(0, captureStartedAt - pending.navigationReadyAt),
            screenshotMs,
            transformMs,
            submitMs,
            width,
            height,
            trackSid
        };
        timeline.emit(TIMELINE_EVENTS.SCREEN_TOUR_FRAME_SUBMITTED, observation, endToEndWorkerMs);
        return observation;
    }

    function frameFailed({
        captureStartedAt,
        failedAt = now(),
        stage,
        error,
        terminal = false
    }) {
        const pending = pendingNavigation;
        if (!pending || captureStartedAt < pending.navigationReadyAt) return false;

        timeline.emit(
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_FAILED,
            {
                url: pending.url,
                kind: pending.kind,
                navigationId: pending.navigationId,
                stage,
                error,
                terminal,
                readyWithoutFrameMs: Math.max(0, failedAt - pending.navigationReadyAt)
            },
            Math.max(0, failedAt - pending.navigationStartedAt)
        );
        if (terminal) pendingNavigation = null;
        return true;
    }

    function abandonPending(reason) {
        const pending = pendingNavigation;
        if (!pending) return false;
        const abandonedAt = now();
        pendingNavigation = null;
        timeline.emit(
            TIMELINE_EVENTS.SCREEN_TOUR_FRAME_ABANDONED,
            {
                url: pending.url,
                kind: pending.kind,
                navigationId: pending.navigationId,
                reason,
                readyWithoutFrameMs: Math.max(0, abandonedAt - pending.navigationReadyAt)
            },
            Math.max(0, abandonedAt - pending.navigationStartedAt)
        );
        return true;
    }

    return {
        navigationReady,
        frameSubmitted,
        frameFailed,
        abandonPending
    };
}
