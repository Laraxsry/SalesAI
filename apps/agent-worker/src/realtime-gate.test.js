import { describe, it, expect, vi } from 'vitest';
import { TrackKind } from '@livekit/rtc-node';
import { hasSubscribedAudioTrack, createRealtimeGate } from './realtime-gate.js';

/**
 * *** COST WARNING ***
 * This suite guards the one thing standing between a stale/ghost session and
 * a real OpenAI bill: `onStart` (the paid Realtime API connection) must fire
 * if and only if a genuine subscribed audio track exists. If a change here
 * makes any of these fail, do not "fix the test to match" without first
 * confirming the new behavior still can't open a billed connection with no
 * one actually talking — see md/backend/phase2_realtime_agent.md for the
 * incident this was written to prevent.
 */

function fakeRoom(participants) {
    return {
        remoteParticipants: new Map(participants.map((p, i) => [`p${i}`, p]))
    };
}

function fakeParticipant(publications) {
    return {
        trackPublications: new Map(publications.map((pub, i) => [`pub${i}`, pub]))
    };
}

describe('hasSubscribedAudioTrack', () => {
    it('is false for a room with no remote participants', () => {
        expect(hasSubscribedAudioTrack(fakeRoom([]))).toBe(false);
    });

    it('is false when the only track is video', () => {
        const room = fakeRoom([
            fakeParticipant([{ kind: TrackKind.KIND_VIDEO, subscribed: true, track: {} }])
        ]);
        expect(hasSubscribedAudioTrack(room)).toBe(false);
    });

    it('is false when an audio publication exists but is not yet subscribed', () => {
        const room = fakeRoom([
            fakeParticipant([{ kind: TrackKind.KIND_AUDIO, subscribed: false, track: undefined }])
        ]);
        expect(hasSubscribedAudioTrack(room)).toBe(false);
    });

    it('is false when subscribed is true but the track handle is not attached yet', () => {
        const room = fakeRoom([
            fakeParticipant([{ kind: TrackKind.KIND_AUDIO, subscribed: true, track: undefined }])
        ]);
        expect(hasSubscribedAudioTrack(room)).toBe(false);
    });

    it('is true once a real audio track is subscribed, even alongside other tracks/participants', () => {
        const room = fakeRoom([
            fakeParticipant([{ kind: TrackKind.KIND_VIDEO, subscribed: true, track: {} }]),
            fakeParticipant([
                { kind: TrackKind.KIND_AUDIO, subscribed: false, track: undefined },
                { kind: TrackKind.KIND_AUDIO, subscribed: true, track: {} }
            ])
        ]);
        expect(hasSubscribedAudioTrack(room)).toBe(true);
    });
});

describe('createRealtimeGate', () => {
    it('does not call onStart on creation — no audio, no cost, by default', () => {
        const onStart = vi.fn();
        createRealtimeGate({ onStart });
        expect(onStart).not.toHaveBeenCalled();
    });

    it('does not call onStart for a subscribed video track', () => {
        const onStart = vi.fn();
        const gate = createRealtimeGate({ onStart });
        gate.handleTrackSubscribed({ kind: TrackKind.KIND_VIDEO });
        expect(onStart).not.toHaveBeenCalled();
        expect(gate.started).toBe(false);
    });

    it('calls onStart exactly once when a real audio track is subscribed', () => {
        const onStart = vi.fn();
        const gate = createRealtimeGate({ onStart });
        gate.handleTrackSubscribed({ kind: TrackKind.KIND_AUDIO });
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(gate.started).toBe(true);
    });

    it('does not call onStart a second time for further audio track events (mic toggled off/on, reconnects)', () => {
        const onStart = vi.fn();
        const gate = createRealtimeGate({ onStart });
        gate.handleTrackSubscribed({ kind: TrackKind.KIND_AUDIO });
        gate.handleTrackSubscribed({ kind: TrackKind.KIND_AUDIO });
        gate.checkAlreadySubscribed(fakeRoom([
            fakeParticipant([{ kind: TrackKind.KIND_AUDIO, subscribed: true, track: {} }])
        ]));
        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('checkAlreadySubscribed starts the session for audio that was subscribed before the listener was attached (join-order race)', () => {
        const onStart = vi.fn();
        const gate = createRealtimeGate({ onStart });
        const room = fakeRoom([
            fakeParticipant([{ kind: TrackKind.KIND_AUDIO, subscribed: true, track: {} }])
        ]);
        gate.checkAlreadySubscribed(room);
        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('checkAlreadySubscribed is a no-op when nobody has published audio yet — this is the ghost-reconnect guarantee', () => {
        const onStart = vi.fn();
        const gate = createRealtimeGate({ onStart });
        gate.checkAlreadySubscribed(fakeRoom([]));
        expect(onStart).not.toHaveBeenCalled();
        expect(gate.started).toBe(false);
    });
});
