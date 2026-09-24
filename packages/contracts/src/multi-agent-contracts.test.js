import { describe, expect, it } from 'vitest';
import {
    AnalystProposalInput,
    ConfirmedContactInput,
    ConfirmedMeetingInput,
    ConversationEventInput,
    FollowUpQuestionInput,
    ParticipantMemoryEventInput,
    ParticipantScopedMemoryInput
} from './index.js';

const eventBase = {
    eventId: 'event-1',
    sessionId: 'session-1',
    participantId: 'participant-1',
    turnIndex: 3,
    routeRevision: 2,
    occurredAt: '2026-09-22T12:00:00.000Z'
};

describe('multi-agent conversation contracts', () => {
    it('allows unattributed transcript events but rejects personal events without attribution', () => {
        expect(ConversationEventInput.safeParse({
            ...eventBase,
            participantId: null,
            type: 'final_transcript',
            payload: { text: 'Merhaba' }
        }).success).toBe(true);

        expect(ConversationEventInput.safeParse({
            ...eventBase,
            participantId: null,
            type: 'contact_candidate',
            payload: { field: 'email', candidateValue: 'ali@example.com' }
        }).success).toBe(false);
    });

    it('validates contact values according to the selected field', () => {
        const base = {
            participantId: 'participant-1',
            sourceEventId: 'source-1',
            confirmationEventId: 'confirmation-1'
        };
        expect(ConfirmedContactInput.safeParse({
            ...base, field: 'email', candidateValue: 'ali@example.com'
        }).success).toBe(true);
        expect(ConfirmedContactInput.safeParse({
            ...base, field: 'email', candidateValue: 'not-an-email'
        }).success).toBe(false);
        expect(ConfirmedContactInput.safeParse({
            ...base, field: 'phone', candidateValue: '0532 123 45 67'
        }).success).toBe(false);
        expect(ConfirmedContactInput.safeParse({
            ...base, field: 'phone', candidateValue: '+905321234567'
        }).success).toBe(true);
    });

    it('requires unique attendees and an IANA timezone for meetings', () => {
        const base = {
            attendeeParticipantIds: ['participant-1'],
            startsAt: '2026-09-24T13:00:00.000Z',
            timezone: 'Europe/Brussels',
            durationMinutes: 30,
            originalPhrase: 'Perşembe saat üç',
            sourceEventId: 'source-1',
            confirmationEventId: 'confirmation-1'
        };
        expect(ConfirmedMeetingInput.safeParse(base).success).toBe(true);
        expect(ConfirmedMeetingInput.safeParse({
            ...base,
            attendeeParticipantIds: ['participant-1', 'participant-1']
        }).success).toBe(false);
        expect(ConfirmedMeetingInput.safeParse({
            ...base,
            timezone: 'Brussels-ish'
        }).success).toBe(false);
    });

    it('requires explicit forwarding consent for a company follow-up question', () => {
        expect(FollowUpQuestionInput.safeParse({
            requestedByParticipantId: 'participant-1',
            question: 'Veriler hangi ülkede tutuluyor?',
            sourceEventId: 'question-1'
        }).success).toBe(false);
    });
});

describe('multi-agent proposal and memory contracts', () => {
    const proposalBase = {
        proposalId: 'proposal-1',
        analystId: 'participant-memory',
        analystVersion: '1.0.0',
        sessionId: 'session-1',
        participantId: 'participant-1',
        sourceEventIds: ['event-1'],
        baseMemoryRevision: 0,
        baseRouteRevision: 0,
        turnIndex: 1,
        confidence: 0.8,
        idempotencyKey: 'session-1:event-1:participant-memory',
        expiresAt: '2026-09-22T12:01:00.000Z'
    };

    it('pins participant memory proposals to a participant', () => {
        const proposal = {
            ...proposalBase,
            proposalType: 'participant_memory',
            payload: { interests: ['güvenlik'] }
        };
        expect(AnalystProposalInput.safeParse(proposal).success).toBe(true);
        expect(AnalystProposalInput.safeParse({ ...proposal, participantId: null }).success).toBe(false);
    });

    it('creates bounded memory defaults and validates accepted events', () => {
        const memory = ParticipantScopedMemoryInput.parse({});
        expect(memory).toMatchObject({ revision: 0, turnIndex: 0, participants: {} });
        expect(ParticipantMemoryEventInput.safeParse({
            eventId: 'accepted-1',
            sourceEventId: 'event-1',
            turnIndex: 1,
            type: 'participant_interest_accepted',
            participantId: 'participant-1',
            payload: { interest: 'güvenlik' }
        }).success).toBe(true);
    });
});
