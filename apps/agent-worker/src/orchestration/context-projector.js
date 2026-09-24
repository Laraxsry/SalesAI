import { ParticipantScopedMemoryInput } from '@repo/contracts';

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function boundedEvent(event, maxTranscriptChars) {
    const copy = structuredClone(event);
    if (copy.type === 'final_transcript') {
        copy.payload.text = copy.payload.text.slice(0, maxTranscriptChars);
    }
    return copy;
}

/** Projects only analyst-declared context; other participants and contact PII never cross. */
export function createBoundedContextProjector({ maxTranscriptChars = 4000 } = {}) {
    return Object.freeze({
        project({ analyst, event, executionContext = {} }) {
            const needs = new Set(analyst.contextNeeds ?? []);
            const memory = ParticipantScopedMemoryInput.parse(executionContext.memory ?? {});
            const participant = event.participantId
                ? memory.participants[event.participantId] ?? null
                : null;
            const projectedParticipant = participant ? {
                knownFacts: participant.knownFacts,
                askedQuestions: participant.askedQuestions,
                interests: participant.interests,
                objections: participant.objections,
                declinedTopics: participant.declinedTopics
            } : null;

            const context = {
                event: boundedEvent(event, maxTranscriptChars),
                memoryRevision: memory.revision,
                routeRevision: executionContext.routeRevision ?? event.routeRevision,
                turnIndex: event.turnIndex
            };
            if (needs.has('participant_memory')) context.participantMemory = projectedParticipant;
            if (needs.has('shared_memory')) context.sharedMemory = structuredClone(memory.shared);
            if (needs.has('route_proposal')) {
                context.routeProposal = structuredClone(executionContext.routeProposal ?? null);
            }
            if (needs.has('planning_context')) {
                context.planningContext = structuredClone(executionContext.planningContext ?? null);
            }
            return deepFreeze(context);
        }
    });
}
