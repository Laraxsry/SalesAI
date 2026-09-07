import { ConnectionState, RoomEvent } from 'livekit-client';

/** Subscribe before checking state so mounting into an already joined room
 * and joining after mount both request the current question. Never publish
 * before Connected: LiveKit caches a failed publisher connection promise,
 * which can make every subsequent answer reject immediately as well. */
export function subscribeSurveyReady(room) {
    function sendReady() {
        if (room.state !== ConnectionState.Connected) return;
        const payload = new TextEncoder().encode(JSON.stringify({ type: 'salesai:survey_ready' }));
        room.localParticipant.publishData(payload, { reliable: true, topic: 'salesai' }).catch((error) => {
            console.warn('[SalesAI survey] Could not request current question', error);
        });
    }

    room.on(RoomEvent.Connected, sendReady);
    room.on(RoomEvent.Reconnected, sendReady);
    sendReady();
    return () => {
        room.off(RoomEvent.Connected, sendReady);
        room.off(RoomEvent.Reconnected, sendReady);
    };
}
