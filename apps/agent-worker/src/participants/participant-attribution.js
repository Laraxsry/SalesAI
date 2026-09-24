import { chooseAttribution } from '../active-speaker.js';

/**
 * Resolves trusted participant context from transport facts. The model never
 * supplies participantId, and unknown attribution stays unknown.
 */
export function resolveTrustedParticipantContext({
    registry,
    eventSpeakerId,
    fallbackIdentity,
    micOnFor
}) {
    if (!registry || typeof registry.getByIdentity !== 'function') {
        throw new TypeError('trusted participant context requires a registry');
    }

    const livekitIdentity = chooseAttribution({
        eventSpeakerId,
        fallbackIdentity,
        micOnFor
    });
    const participant = livekitIdentity
        ? registry.getByIdentity(livekitIdentity)
        : null;

    if (!participant) {
        return Object.freeze({
            sessionId: registry.sessionId,
            participantId: null,
            livekitIdentity: null,
            claimedDisplayName: null,
            visitorKey: null,
            attribution: 'unattributed'
        });
    }

    return Object.freeze({
        sessionId: registry.sessionId,
        participantId: participant.participantId,
        livekitIdentity: participant.livekitIdentity,
        claimedDisplayName: participant.claimedDisplayName,
        visitorKey: participant.visitorKey,
        attribution: eventSpeakerId ? 'event_speaker' : 'active_speaker'
    });
}
