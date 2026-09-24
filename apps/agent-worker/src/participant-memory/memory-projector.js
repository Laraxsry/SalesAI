import {
    ParticipantScopedMemoryInput,
    SpeakingAgentMemoryProjectionInput
} from '@repo/contracts';

function tail(values, limit) {
    return values.slice(-limit);
}

/** Produces a bounded, PII-free view for the realtime speaking agent. */
export function projectSpeakingAgentMemory(memoryInput, activeParticipantId = null) {
    const memory = ParticipantScopedMemoryInput.parse(memoryInput);
    const participant = activeParticipantId
        ? memory.participants[activeParticipantId] ?? null
        : null;

    return SpeakingAgentMemoryProjectionInput.parse({
        revision: memory.revision,
        turnIndex: memory.turnIndex,
        activeParticipant: participant ? {
            participantId: activeParticipantId,
            knownFacts: tail(participant.knownFacts, 30),
            askedQuestions: tail(participant.askedQuestions, 30),
            interests: tail(participant.interests, 30),
            objections: tail(participant.objections, 30),
            declinedTopics: tail(participant.declinedTopics, 30)
        } : null,
        shared: {
            coveredTopics: tail(memory.shared.coveredTopics, 100),
            openQuestions: tail(memory.shared.openQuestions, 100),
            companyFacts: tail(memory.shared.companyFacts, 100),
            currentRouteRevision: memory.shared.currentRouteRevision
        }
    });
}
