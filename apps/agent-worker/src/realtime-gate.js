import { TrackKind } from '@livekit/rtc-node';

/**
 * *** COST WARNING — read before touching this file ***
 *
 * `agent.js` calls `onStart` (via `createRealtimeGate`) to start the paid
 * voice pipeline — a persistent OpenAI transcription websocket that starts
 * accruing real per-minute cost the moment it opens, plus every LLM and TTS
 * call the conversation then drives. This gate exists specifically so that
 * opening it is tied to a genuine "the visitor's microphone is actually
 * live" signal, not to "the agent joined the room" (free) or a time/log
 * heuristic.
 *
 * Without this gate, a stale/ghost reconnect (e.g. a browser tab resuming
 * after sleep and silently rejoining an already-ended session — see
 * md/backend/phase2_realtime_agent.md) can re-open a real OpenAI billing
 * session with nobody actually talking. If you change this logic, re-run
 * realtime-gate.test.js and confirm `onStart` still fires only once a real
 * subscribed audio track exists — a regression here is a live API-cost leak,
 * not just a cosmetic bug.
 */

/**
 * Whether a room already has a subscribed (i.e. actually flowing) audio
 * track from a remote participant, checked at a single point in time.
 *
 * Exists because dispatch/join order isn't guaranteed: the visitor's mic can
 * already be published and subscribed before the agent-worker gets a chance
 * to attach its `trackSubscribed` listener (e.g. VisitRoom enables the mic
 * as soon as it mounts). Without this check, that race would mean the gate
 * waits forever for an event that already happened.
 *
 * @param {{ remoteParticipants: Map<string, { trackPublications: Map<string, { kind:number, subscribed:boolean, track?:object }> }> }} room
 */
export function hasSubscribedAudioTrack(room) {
    for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.trackPublications.values()) {
            if (pub.kind === TrackKind.KIND_AUDIO && pub.subscribed && pub.track) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Ensures `onStart` (the costly OpenAI voice pipeline) fires at most
 * once, and only once real visitor audio exists to justify it. Pure
 * in-memory gating, no I/O — mirrors `session-cost-tracker.js`'s shape.
 *
 * @param {{ onStart: () => void }} opts
 */
export function createRealtimeGate({ onStart }) {
    let started = false;

    function start() {
        if (started) return;
        started = true;
        onStart();
    }

    return {
        /** Call once, right after attaching `handleTrackSubscribed` as a room listener, to catch audio subscribed before the listener existed. */
        checkAlreadySubscribed(room) {
            if (hasSubscribedAudioTrack(room)) start();
        },
        /** Wire directly to the room's `trackSubscribed` event. */
        handleTrackSubscribed(track) {
            if (track.kind === TrackKind.KIND_AUDIO) start();
        },
        get started() {
            return started;
        }
    };
}
