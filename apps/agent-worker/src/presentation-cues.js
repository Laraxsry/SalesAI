import { safeTourMonitor } from './tour-diagnostics.js';

const PRESENTATION_TOPIC = 'salesai';

export function createPresentationCuePublisher({ participant, onEvent, now = () => Date.now() }) {
    let sequence = 0;
    const emit = safeTourMonitor(onEvent);
    return async function publishPresentationCue(cue) {
        const message = {
            type: 'salesai:presentation',
            cueId: `presentation-${++sequence}`,
            emittedAt: now(),
            ...cue
        };
        const payload = new TextEncoder().encode(JSON.stringify(message));
        const started = now();
        const meta = { cueId: message.cueId, operationId: message.operationId, action: message.action,
            viewVersion: message.viewVersion, target: message.target, style: message.style,
            direction: message.direction, reason: message.reason, durationMs: message.durationMs, bytes: payload.length };
        emit('begin', meta);
        try {
            await participant.publishData(payload, { reliable: true, topic: PRESENTATION_TOPIC });
            emit('end', { ...meta, status: 'published', publishMs: now() - started });
        } catch (error) {
            emit('end', { ...meta, status: 'error', publishMs: now() - started, error: error.message });
            throw error;
        }
        return message;
    };
}

export { PRESENTATION_TOPIC };
