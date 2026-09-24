import { AnalystProposalInput, ParticipantMemoryEventInput } from '@repo/contracts';

const FIELD_EVENT = {
    knownFacts: ['participant_fact_accepted', 'fact'],
    interests: ['participant_interest_accepted', 'interest'],
    objections: ['participant_objection_accepted', 'objection'],
    askedQuestions: ['participant_question_recorded', 'question'],
    declinedTopics: ['participant_topic_declined', 'topic']
};

function stableHash(value) {
    let hash = 2166136261;
    for (const char of value) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Converts a validated advisory proposal into deterministic reducer inputs. */
export function mapParticipantMemoryProposalToEvents(input) {
    const proposal = AnalystProposalInput.parse(input);
    if (proposal.proposalType !== 'participant_memory') return [];

    const events = [];
    for (const [field, [eventType, payloadKey]] of Object.entries(FIELD_EVENT)) {
        proposal.payload[field].forEach((value, index) => {
            events.push(ParticipantMemoryEventInput.parse({
                eventId: `accepted:${stableHash(`${proposal.proposalId}:${field}:${index}:${value}`)}`,
                sourceEventId: proposal.sourceEventIds[0],
                turnIndex: proposal.turnIndex,
                type: eventType,
                participantId: proposal.participantId,
                payload: { [payloadKey]: value }
            }));
        });
    }
    return events;
}
