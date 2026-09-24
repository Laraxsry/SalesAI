import { randomUUID } from 'node:crypto';

function normalizedText(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
}

function normalizedName(value) {
    return normalizedText(value)?.toLocaleLowerCase('tr') ?? null;
}

function copyParticipant(participant) {
    return participant ? { ...participant } : null;
}

/**
 * Session-local identity registry. LiveKit identities may change on reconnect;
 * participantId and visitorKey are the durable identities inside the call.
 */
export function createParticipantRegistry({
    sessionId,
    initialParticipants = [],
    createParticipantId = () => randomUUID()
} = {}) {
    if (!normalizedText(sessionId)) throw new TypeError('participant registry requires sessionId');
    if (typeof createParticipantId !== 'function') throw new TypeError('createParticipantId must be a function');

    const byParticipantId = new Map();
    const identityIndex = new Map();

    function index(participant) {
        byParticipantId.set(participant.participantId, participant);
        if (participant.livekitIdentity) {
            identityIndex.set(participant.livekitIdentity, participant.participantId);
        }
    }

    function findReturning({ visitorKey, claimedDisplayName }) {
        if (visitorKey) {
            return [...byParticipantId.values()].find((participant) =>
                participant.visitorKey === visitorKey) ?? null;
        }
        const name = normalizedName(claimedDisplayName);
        if (!name) return null;
        const matches = [...byParticipantId.values()].filter((participant) =>
            participant.connected === false
            && !participant.visitorKey
            && normalizedName(participant.claimedDisplayName) === name);
        return matches.length === 1 ? matches[0] : null;
    }

    function upsert(raw = {}) {
        const livekitIdentity = normalizedText(raw.livekitIdentity ?? raw.identity);
        const visitorKey = normalizedText(raw.visitorKey);
        const claimedDisplayName = normalizedText(raw.claimedDisplayName ?? raw.name);
        const suppliedParticipantId = normalizedText(raw.participantId);

        if (!livekitIdentity) throw new TypeError('participant requires livekit identity');

        const indexedId = identityIndex.get(livekitIdentity);
        let participant = indexedId ? byParticipantId.get(indexedId) : null;
        if (!participant && suppliedParticipantId) {
            participant = byParticipantId.get(suppliedParticipantId) ?? null;
        }
        if (!participant) participant = findReturning({ visitorKey, claimedDisplayName });

        if (!participant) {
            participant = {
                participantId: suppliedParticipantId ?? normalizedText(createParticipantId()),
                livekitIdentity,
                visitorKey,
                claimedDisplayName,
                connected: true
            };
            if (!participant.participantId) throw new TypeError('createParticipantId returned an empty id');
            index(participant);
            return copyParticipant(participant);
        }

        if (participant.livekitIdentity && participant.livekitIdentity !== livekitIdentity) {
            identityIndex.delete(participant.livekitIdentity);
        }
        participant.livekitIdentity = livekitIdentity;
        participant.visitorKey = participant.visitorKey ?? visitorKey;
        participant.claimedDisplayName = claimedDisplayName ?? participant.claimedDisplayName;
        participant.connected = true;
        index(participant);
        return copyParticipant(participant);
    }

    function markDisconnected(identity) {
        const participantId = identityIndex.get(normalizedText(identity));
        const participant = participantId ? byParticipantId.get(participantId) : null;
        if (!participant) return null;
        identityIndex.delete(participant.livekitIdentity);
        participant.connected = false;
        return copyParticipant(participant);
    }

    for (const participant of initialParticipants) {
        const registered = upsert(participant);
        if (participant?.leftAt) markDisconnected(registered.livekitIdentity);
    }

    return Object.freeze({
        sessionId,
        upsert,
        markDisconnected,
        getByIdentity(identity) {
            const participantId = identityIndex.get(normalizedText(identity));
            return copyParticipant(participantId ? byParticipantId.get(participantId) : null);
        },
        getByParticipantId(participantId) {
            return copyParticipant(byParticipantId.get(normalizedText(participantId)) ?? null);
        },
        list() {
            return [...byParticipantId.values()].map(copyParticipant);
        }
    });
}
