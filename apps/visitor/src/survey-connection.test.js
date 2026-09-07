import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState, Room, RoomEvent } from 'livekit-client';
import { subscribeSurveyReady } from './survey-connection.js';

const encode = (message) => new TextEncoder().encode(JSON.stringify(message));
const options = { reliable: true, topic: 'salesai' };

afterEach(() => vi.restoreAllMocks());

describe('survey connection lifecycle', () => {
    it('reproduces the SDK caching an early failure even after transport becomes available', async () => {
        const room = new Room();
        await expect(room.localParticipant.publishData(encode({ type: 'salesai:survey_ready' }), options))
            .rejects.toThrow('PC manager is closed');

        // Model the transport becoming available after the premature publish.
        // Keep the real SDK publisher-promise cache: it must reproduce the bug.
        const connect = vi.spyOn(room.engine, 'ensureDataTransportConnected').mockResolvedValue();
        await expect(room.localParticipant.publishData(encode({ answer: 'Fon' }), options))
            .rejects.toThrow('PC manager is closed');
        expect(connect).not.toHaveBeenCalled();
    });

    it.each([ConnectionState.Disconnected, ConnectionState.Connecting, ConnectionState.Reconnecting])(
        'does not initialize the publisher while %s', (state) => {
            const room = new Room();
            room.state = state;
            const publish = vi.spyOn(room.localParticipant, 'publishData').mockResolvedValue();
            const stop = subscribeSurveyReady(room);
            expect(publish).not.toHaveBeenCalled();
            stop();
        }
    );

    it('keeps the real SDK publisher usable for choice and text answers after joining', async () => {
        const room = new Room();
        const publish = vi.spyOn(room.localParticipant, 'publishData');
        const stop = subscribeSurveyReady(room);
        expect(publish).not.toHaveBeenCalled();

        // Replace only WebRTC I/O, retaining publishData/sendDataPacket and
        // ensurePublisherConnected so the regression exercises the SDK cache.
        vi.spyOn(room.engine, 'ensureDataTransportConnected').mockResolvedValue();
        const send = vi.spyOn(room.engine.reliableChannel, 'send').mockResolvedValue();
        room.state = ConnectionState.Connected;
        room.emit(RoomEvent.Connected);
        await expect(publish.mock.results[0].value).resolves.toBeUndefined();
        expect(JSON.parse(new TextDecoder().decode(publish.mock.calls[0][0])))
            .toEqual({ type: 'salesai:survey_ready' });
        for (const answer of ['Fon', 'altın']) {
            await expect(room.localParticipant.publishData(encode({
                type: 'salesai:survey_answer', nodeId: 'investment', answer
            }), options)).resolves.toBeUndefined();
        }
        expect(send).toHaveBeenCalledTimes(3);
        stop();
    });

    it('resyncs on reconnect and removes listeners on unmount', async () => {
        const room = new Room();
        room.state = ConnectionState.Connected;
        const publish = vi.spyOn(room.localParticipant, 'publishData').mockResolvedValue();
        const stop = subscribeSurveyReady(room);
        expect(publish).toHaveBeenCalledTimes(1);
        room.emit(RoomEvent.Reconnected);
        expect(publish).toHaveBeenCalledTimes(2);
        stop();
        room.emit(RoomEvent.Connected);
        room.emit(RoomEvent.Reconnected);
        expect(publish).toHaveBeenCalledTimes(2);
    });
});
