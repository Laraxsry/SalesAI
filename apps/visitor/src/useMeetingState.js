import { useEffect, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { applyMeetingMessage } from './meeting-status.js';

/**
 * Subscribes to the agent-worker's `salesai:meeting` broadcasts and returns the
 * latest group-meeting state (phase, floor, raised hands). `null` until the
 * first message arrives / in a 1-on-1 call. Görev #11.
 */
export function useMeetingState() {
    const room = useRoomContext();
    const [state, setState] = useState(null);

    useEffect(() => {
        function onData(payload) {
            setState((prev) => applyMeetingMessage(prev, payload));
        }
        room.on(RoomEvent.DataReceived, onData);
        return () => room.off(RoomEvent.DataReceived, onData);
    }, [room]);

    return state;
}
