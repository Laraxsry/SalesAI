import { z } from 'zod';

const Id = z.string().trim().min(1).max(160);
const ParticipantId = z.string().trim().min(1).max(120);
const MemoryText = z.string().trim().min(1).max(500);
const ContactValueByField = {
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/),
    company: z.string().trim().min(1).max(240)
};

export const ParticipantContactMemoryInput = z.object({
    name: ContactValueByField.name.nullable().default(null),
    email: ContactValueByField.email.nullable().default(null),
    phone: ContactValueByField.phone.nullable().default(null),
    company: ContactValueByField.company.nullable().default(null)
}).strict();

export const ParticipantMemoryRecordInput = z.object({
    knownFacts: z.array(MemoryText).max(100).default([]),
    askedQuestions: z.array(MemoryText).max(100).default([]),
    interests: z.array(MemoryText).max(100).default([]),
    objections: z.array(MemoryText).max(100).default([]),
    declinedTopics: z.array(MemoryText).max(100).default([]),
    confirmedContact: ParticipantContactMemoryInput.default({}),
    consent: z.record(z.boolean()).default({})
}).strict();

export const ParticipantScopedMemoryInput = z.object({
    revision: z.number().int().min(0).default(0),
    turnIndex: z.number().int().min(0).default(0),
    processedEventIds: z.array(Id).max(2000).default([]),
    shared: z.object({
        coveredTopics: z.array(MemoryText).max(500).default([]),
        openQuestions: z.array(MemoryText).max(500).default([]),
        companyFacts: z.array(MemoryText).max(500).default([]),
        currentRouteRevision: z.number().int().min(0).default(0)
    }).strict().default({}),
    participants: z.record(ParticipantMemoryRecordInput).default({})
}).strict();

const memoryEventEnvelope = {
    eventId: Id,
    sourceEventId: Id,
    turnIndex: z.number().int().min(0)
};

function memoryEvent(type, payload, participant = false) {
    return z.object({
        ...memoryEventEnvelope,
        type: z.literal(type),
        participantId: participant ? ParticipantId : ParticipantId.nullable().default(null),
        payload
    }).strict();
}

const ParticipantContactConfirmedMemoryEventInput = memoryEvent(
    'participant_contact_confirmed',
    z.object({
        field: z.enum(['name', 'email', 'phone', 'company']),
        value: z.string().trim().min(1).max(500)
    }).strict(),
    true
).superRefine((event, ctx) => {
    const parsed = ContactValueByField[event.payload.field].safeParse(event.payload.value);
    if (!parsed.success) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['payload', 'value'],
            message: `Invalid confirmed ${event.payload.field}`
        });
    }
});

export const ParticipantMemoryEventInput = z.union([
    memoryEvent('shared_topic_covered', z.object({ topic: MemoryText }).strict()),
    memoryEvent('shared_question_opened', z.object({ question: MemoryText }).strict()),
    memoryEvent('shared_question_resolved', z.object({ question: MemoryText }).strict()),
    memoryEvent('shared_company_fact_accepted', z.object({ fact: MemoryText }).strict()),
    memoryEvent('route_revision_accepted', z.object({ routeRevision: z.number().int().min(0) }).strict()),
    memoryEvent('participant_fact_accepted', z.object({ fact: MemoryText }).strict(), true),
    memoryEvent('participant_question_recorded', z.object({ question: MemoryText }).strict(), true),
    memoryEvent('participant_interest_accepted', z.object({ interest: MemoryText }).strict(), true),
    memoryEvent('participant_objection_accepted', z.object({ objection: MemoryText }).strict(), true),
    memoryEvent('participant_topic_declined', z.object({ topic: MemoryText }).strict(), true),
    ParticipantContactConfirmedMemoryEventInput,
    memoryEvent('participant_consent_updated', z.object({
        key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
        granted: z.boolean()
    }).strict(), true)
]);

export const SpeakingAgentMemoryProjectionInput = z.object({
    revision: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    activeParticipant: z.object({
        participantId: ParticipantId,
        knownFacts: z.array(MemoryText).max(30),
        askedQuestions: z.array(MemoryText).max(30),
        interests: z.array(MemoryText).max(30),
        objections: z.array(MemoryText).max(30),
        declinedTopics: z.array(MemoryText).max(30)
    }).strict().nullable(),
    shared: z.object({
        coveredTopics: z.array(MemoryText).max(100),
        openQuestions: z.array(MemoryText).max(100),
        companyFacts: z.array(MemoryText).max(100),
        currentRouteRevision: z.number().int().min(0)
    }).strict()
}).strict();
