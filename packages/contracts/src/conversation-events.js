import { z } from 'zod';

const EventId = z.string().trim().min(1).max(160);
const SessionId = z.string().trim().min(1).max(120);
const ParticipantId = z.string().trim().min(1).max(120);
const NonEmptyText = z.string().trim().min(1);

const envelope = {
    eventId: EventId,
    sessionId: SessionId,
    participantId: ParticipantId.nullable().default(null),
    turnIndex: z.number().int().min(0),
    routeRevision: z.number().int().min(0),
    occurredAt: z.string().datetime({ offset: true })
};

function event(type, payload) {
    return z.object({ ...envelope, type: z.literal(type), payload }).strict();
}

function participantEvent(type, payload) {
    return event(type, payload).superRefine((value, ctx) => {
        if (!value.participantId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['participantId'],
                message: `${type} requires trusted participant attribution`
            });
        }
    });
}

export const FinalTranscriptEventInput = event('final_transcript', z.object({
    text: NonEmptyText.max(8000),
    language: z.string().trim().min(2).max(35).nullable().default(null),
    speakerIdentity: z.string().trim().min(1).max(180).nullable().default(null)
}).strict());

export const ContactCandidateEventInput = participantEvent('contact_candidate', z.object({
    field: z.enum(['name', 'email', 'phone', 'company']),
    candidateValue: NonEmptyText.max(500)
}).strict());

export const ContactConfirmedEventInput = participantEvent('contact_confirmed', z.object({
    field: z.enum(['name', 'email', 'phone', 'company']),
    candidateEventId: EventId,
    valueRef: EventId
}).strict());

export const SurveyAnsweredEventInput = participantEvent('survey_answered', z.object({
    questionKey: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    answerRef: EventId
}).strict());

export const MeetingIntentEventInput = participantEvent('meeting_intent', z.object({
    originalPhrase: NonEmptyText.max(1000),
    timezoneHint: z.string().trim().min(1).max(100).nullable().default(null)
}).strict());

export const MeetingConfirmedEventInput = participantEvent('meeting_confirmed', z.object({
    intentEventId: EventId,
    attendeeParticipantIds: z.array(ParticipantId).min(1).max(20),
    startsAt: z.string().datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(100),
    durationMinutes: z.number().int().min(5).max(480)
}).strict());

export const CompanyQuestionEventInput = participantEvent('company_question', z.object({
    question: NonEmptyText.max(2000),
    forwardingConsentEventId: EventId.nullable().default(null)
}).strict());

export const FollowUpConsentConfirmedEventInput = participantEvent(
    'follow_up_consent_confirmed',
    z.object({ questionEventId: EventId }).strict()
);

export const RouteProposedEventInput = event('route_proposed', z.object({
    proposalId: EventId,
    reason: NonEmptyText.max(500)
}).strict());

export const SessionEndingEventInput = event('session_ending', z.object({
    reason: z.enum(['participant_left', 'agent_ended', 'timeout', 'error'])
}).strict());

export const ConversationEventInput = z.union([
    FinalTranscriptEventInput,
    ContactCandidateEventInput,
    ContactConfirmedEventInput,
    SurveyAnsweredEventInput,
    MeetingIntentEventInput,
    MeetingConfirmedEventInput,
    CompanyQuestionEventInput,
    FollowUpConsentConfirmedEventInput,
    RouteProposedEventInput,
    SessionEndingEventInput
]);

export const CONVERSATION_EVENT_TYPES = Object.freeze([
    'final_transcript',
    'contact_candidate',
    'contact_confirmed',
    'survey_answered',
    'meeting_intent',
    'meeting_confirmed',
    'company_question',
    'follow_up_consent_confirmed',
    'route_proposed',
    'session_ending'
]);
