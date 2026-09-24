import { z } from 'zod';

const Id = z.string().trim().min(1).max(160);
const ParticipantId = z.string().trim().min(1).max(120);
const MemoryText = z.string().trim().min(1).max(500);

const envelope = {
    proposalId: Id,
    analystId: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,95}$/),
    analystVersion: z.string().trim().min(1).max(40),
    sessionId: z.string().trim().min(1).max(120),
    participantId: ParticipantId.nullable().default(null),
    sourceEventIds: z.array(Id).min(1).max(20),
    baseMemoryRevision: z.number().int().min(0),
    baseRouteRevision: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    confidence: z.number().min(0).max(1),
    idempotencyKey: z.string().trim().min(1).max(240),
    expiresAt: z.string().datetime({ offset: true })
};

function proposal(proposalType, payload) {
    return z.object({
        ...envelope,
        proposalType: z.literal(proposalType),
        payload
    }).strict();
}

export const ParticipantMemoryProposalInput = proposal('participant_memory', z.object({
    knownFacts: z.array(MemoryText).max(20).default([]),
    interests: z.array(MemoryText).max(20).default([]),
    objections: z.array(MemoryText).max(20).default([]),
    askedQuestions: z.array(MemoryText).max(20).default([]),
    declinedTopics: z.array(MemoryText).max(20).default([])
}).strict()).superRefine((value, ctx) => {
    if (!value.participantId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['participantId'],
            message: 'Participant memory proposals require participantId'
        });
    }
});

export const FollowUpClassificationProposalInput = proposal('follow_up_classification', z.object({
    category: z.string().trim().min(1).max(120),
    department: z.string().trim().min(1).max(120).nullable().default(null),
    priority: z.enum(['low', 'normal', 'high'])
}).strict());

export const RouteCritiqueProposalInput = proposal('route_critique', z.object({
    issueCodes: z.array(z.enum([
        'repetitive',
        'irrelevant',
        'unnecessary_demo',
        'missing_customer_answer',
        'sales_imbalance'
    ])).max(20).default([]),
    removeNodeIds: z.array(z.string().trim().min(1).max(96)).max(20).default([])
}).strict());

export const ContactAssessmentProposalInput = proposal('contact_assessment', z.object({
    field: z.enum(['name', 'email', 'phone', 'company']),
    candidateEventId: Id,
    status: z.enum(['needs_confirmation', 'confirmed_by_evidence', 'rejected'])
}).strict());

export const MeetingNormalizationProposalInput = proposal('meeting_normalization', z.object({
    startsAt: z.string().datetime({ offset: true }).nullable(),
    timezone: z.string().trim().min(1).max(100).nullable(),
    durationMinutes: z.number().int().min(5).max(480).nullable(),
    needsClarification: z.array(z.enum(['date', 'time', 'timezone', 'duration'])).max(4)
}).strict());

export const AnalystProposalInput = z.union([
    ParticipantMemoryProposalInput,
    FollowUpClassificationProposalInput,
    RouteCritiqueProposalInput,
    ContactAssessmentProposalInput,
    MeetingNormalizationProposalInput
]);
