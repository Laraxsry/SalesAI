import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { applySurveyMessage } from './survey-state.js';
import { subscribeSurveyReady } from './survey-connection.js';

export function useInCallSurvey(room) {
    const [survey, setSurvey] = useState(null);
    const pendingAnswers = useRef(new Map());

    useEffect(() => {
        function onData(payload) {
            try {
                const message = JSON.parse(new TextDecoder().decode(payload));
                if (message?.type === 'salesai:survey_answer_ack' && message.answerId) {
                    const pending = pendingAnswers.current.get(message.answerId);
                    if (!pending) return;
                    window.clearTimeout(pending.timeoutId);
                    pendingAnswers.current.delete(message.answerId);
                    if (message.ok) {
                        setSurvey((current) => (current?.nodeId === pending.nodeId ? null : current));
                        pending.resolve();
                    } else {
                        pending.reject(new Error(message.error || 'survey answer rejected'));
                    }
                    return;
                }
            } catch {
                // Non-JSON room data is unrelated to the survey protocol.
            }
            setSurvey((current) => applySurveyMessage(current, payload));
        }
        room.on(RoomEvent.DataReceived, onData);

        const stopReady = subscribeSurveyReady(room);
        return () => {
            stopReady();
            room.off(RoomEvent.DataReceived, onData);
            for (const pending of pendingAnswers.current.values()) {
                window.clearTimeout(pending.timeoutId);
                pending.reject(new Error('survey disconnected'));
            }
            pendingAnswers.current.clear();
        };
    }, [room]);

    const answer = useCallback(async (nodeId, value, { skipped = false } = {}) => {
        if (room.state !== ConnectionState.Connected) {
            throw new Error('survey disconnected');
        }
        const answerId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const payload = new TextEncoder().encode(JSON.stringify({
            type: 'salesai:survey_answer',
            answerId,
            nodeId,
            answer: skipped ? null : String(value || '').trim(),
            skipped
        }));
        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                pendingAnswers.current.delete(answerId);
                reject(new Error('survey answer acknowledgement timeout'));
            }, 8000);
            pendingAnswers.current.set(answerId, { nodeId, resolve, reject, timeoutId });
            // The application-level ACK below is authoritative. Some LiveKit
            // transports keep this Promise pending despite accepting the data,
            // so only use an explicit rejection as an early failure signal.
            room.localParticipant.publishData(payload, { reliable: true, topic: 'salesai' }).catch((error) => {
                const pending = pendingAnswers.current.get(answerId);
                if (!pending) return;
                window.clearTimeout(pending.timeoutId);
                pendingAnswers.current.delete(answerId);
                reject(error);
            });
        });
    }, [room]);

    return { survey, answer };
}
