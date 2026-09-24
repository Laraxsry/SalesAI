import {
    ParticipantContactMemoryInput,
    ParticipantMemoryEventInput,
    ParticipantMemoryRecordInput,
    ParticipantScopedMemoryInput
} from '@repo/contracts';

function appendUnique(values, value, limit) {
    if (values.includes(value)) return values;
    return [...values, value].slice(-limit);
}

function removeValue(values, value) {
    return values.includes(value) ? values.filter((item) => item !== value) : values;
}

function participantRecord(memory, participantId) {
    return memory.participants[participantId] ?? ParticipantMemoryRecordInput.parse({});
}

function withParticipant(memory, participantId, update) {
    const current = participantRecord(memory, participantId);
    const next = update(current);
    return next === current ? memory : {
        ...memory,
        participants: { ...memory.participants, [participantId]: next }
    };
}

function applyEvent(memory, event) {
    switch (event.type) {
        case 'shared_topic_covered': {
            const coveredTopics = appendUnique(memory.shared.coveredTopics, event.payload.topic, 500);
            return coveredTopics === memory.shared.coveredTopics ? memory : {
                ...memory, shared: { ...memory.shared, coveredTopics }
            };
        }
        case 'shared_question_opened': {
            const openQuestions = appendUnique(memory.shared.openQuestions, event.payload.question, 500);
            return openQuestions === memory.shared.openQuestions ? memory : {
                ...memory, shared: { ...memory.shared, openQuestions }
            };
        }
        case 'shared_question_resolved': {
            const openQuestions = removeValue(memory.shared.openQuestions, event.payload.question);
            return openQuestions === memory.shared.openQuestions ? memory : {
                ...memory, shared: { ...memory.shared, openQuestions }
            };
        }
        case 'shared_company_fact_accepted': {
            const companyFacts = appendUnique(memory.shared.companyFacts, event.payload.fact, 500);
            return companyFacts === memory.shared.companyFacts ? memory : {
                ...memory, shared: { ...memory.shared, companyFacts }
            };
        }
        case 'route_revision_accepted':
            if (event.payload.routeRevision <= memory.shared.currentRouteRevision) return memory;
            return {
                ...memory,
                shared: { ...memory.shared, currentRouteRevision: event.payload.routeRevision }
            };
        case 'participant_fact_accepted':
            return withParticipant(memory, event.participantId, (record) => {
                const knownFacts = appendUnique(record.knownFacts, event.payload.fact, 100);
                return knownFacts === record.knownFacts ? record : { ...record, knownFacts };
            });
        case 'participant_question_recorded':
            return withParticipant(memory, event.participantId, (record) => {
                const askedQuestions = appendUnique(record.askedQuestions, event.payload.question, 100);
                return askedQuestions === record.askedQuestions ? record : { ...record, askedQuestions };
            });
        case 'participant_interest_accepted':
            return withParticipant(memory, event.participantId, (record) => {
                const interests = appendUnique(record.interests, event.payload.interest, 100);
                return interests === record.interests ? record : { ...record, interests };
            });
        case 'participant_objection_accepted':
            return withParticipant(memory, event.participantId, (record) => {
                const objections = appendUnique(record.objections, event.payload.objection, 100);
                return objections === record.objections ? record : { ...record, objections };
            });
        case 'participant_topic_declined':
            return withParticipant(memory, event.participantId, (record) => {
                const declinedTopics = appendUnique(record.declinedTopics, event.payload.topic, 100);
                return declinedTopics === record.declinedTopics ? record : { ...record, declinedTopics };
            });
        case 'participant_contact_confirmed':
            return withParticipant(memory, event.participantId, (record) => {
                const confirmedContact = ParticipantContactMemoryInput.safeParse({
                    ...record.confirmedContact,
                    [event.payload.field]: event.payload.value
                });
                return confirmedContact.success
                    ? { ...record, confirmedContact: confirmedContact.data }
                    : record;
            });
        case 'participant_consent_updated':
            return withParticipant(memory, event.participantId, (record) => ({
                ...record,
                consent: { ...record.consent, [event.payload.key]: event.payload.granted }
            }));
        default:
            return memory;
    }
}

/** Pure, idempotent reducer. Only accepted memory events may enter this boundary. */
export function reduceParticipantScopedMemory(memoryInput, eventInput) {
    const memoryResult = ParticipantScopedMemoryInput.safeParse(memoryInput);
    const eventResult = ParticipantMemoryEventInput.safeParse(eventInput);
    if (!memoryResult.success || !eventResult.success) return memoryInput;

    const memory = memoryResult.data;
    const event = eventResult.data;
    if (memory.processedEventIds.includes(event.eventId)) return memoryInput;

    const applied = applyEvent(memory, event);
    return ParticipantScopedMemoryInput.parse({
        ...applied,
        revision: memory.revision + 1,
        turnIndex: Math.max(memory.turnIndex, event.turnIndex),
        processedEventIds: [...memory.processedEventIds, event.eventId].slice(-2000)
    });
}
