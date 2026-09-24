import { z } from 'zod';

const Id = z.string().trim().min(1).max(160);
const ParticipantId = z.string().trim().min(1).max(120);

export const ContactField = z.enum(['name', 'email', 'phone', 'company']);

const ContactValue = z.object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/),
    company: z.string().trim().min(1).max(240)
});

export const ConfirmedContactInput = z.object({
    participantId: ParticipantId,
    field: ContactField,
    candidateValue: z.string().trim().min(1).max(500),
    sourceEventId: Id,
    confirmationEventId: Id
}).strict().superRefine((input, ctx) => {
    const parsed = ContactValue.shape[input.field].safeParse(input.candidateValue);
    if (!parsed.success) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['candidateValue'],
            message: `Invalid confirmed ${input.field}`
        });
    }
});

export const ConfirmedMeetingInput = z.object({
    attendeeParticipantIds: z.array(ParticipantId).min(1).max(20),
    startsAt: z.string().datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(100),
    durationMinutes: z.number().int().min(5).max(480),
    originalPhrase: z.string().trim().min(1).max(1000),
    sourceEventId: Id,
    confirmationEventId: Id
}).strict().superRefine((input, ctx) => {
    if (new Set(input.attendeeParticipantIds).size !== input.attendeeParticipantIds.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['attendeeParticipantIds'],
            message: 'Meeting attendees must be unique'
        });
    }
    try {
        new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format();
    } catch {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['timezone'],
            message: 'Meeting timezone must be a valid IANA timezone'
        });
    }
});

export const FollowUpQuestionInput = z.object({
    requestedByParticipantId: ParticipantId,
    question: z.string().trim().min(1).max(2000),
    category: z.string().trim().min(1).max(120).nullable().default(null),
    sourceEventId: Id,
    forwardingConsentEventId: Id
}).strict();
