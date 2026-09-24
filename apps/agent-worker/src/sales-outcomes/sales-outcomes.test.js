import { describe, expect, it } from 'vitest';
import { createContactService } from './contact-service.js';
import { createMeetingService } from './meeting-service.js';
import { createFollowUpService } from './follow-up-service.js';
import {
    createInMemoryConversationEventReader,
    createInMemorySalesOutcomeRepositories
} from './repositories.js';
import { projectSessionContacts } from './sales-outcome-projector.js';

const occurredAt = '2026-09-22T12:00:00.000Z';
const sessionContext = {
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    productId: 'product-1',
    participantIds: ['participant-ali', 'participant-ayse']
};
const aliContext = {
    sessionId: 'session-1',
    participantId: 'participant-ali',
    attribution: 'event_speaker'
};

function event(eventId, type, participantId, payload) {
    return {
        eventId, type, sessionId: 'session-1', participantId,
        turnIndex: 1, routeRevision: 0, occurredAt, payload
    };
}

describe('contact application service', () => {
    it('persists canonical contact once with same-participant evidence', async () => {
        const events = createInMemoryConversationEventReader([
            event('candidate-1', 'contact_candidate', 'participant-ali', {
                field: 'email', candidateValue: 'ali@example.com'
            }),
            event('confirmation-1', 'contact_confirmed', 'participant-ali', {
                field: 'email', candidateEventId: 'candidate-1', valueRef: 'candidate-1'
            })
        ]);
        const repositories = createInMemorySalesOutcomeRepositories();
        const service = createContactService({ repository: repositories.contacts, eventReader: events });
        const request = {
            input: {
                participantId: 'participant-ali', field: 'email',
                candidateValue: 'ali@example.com', sourceEventId: 'candidate-1',
                confirmationEventId: 'confirmation-1'
            },
            participantContext: aliContext,
            sessionContext
        };

        const first = await service.confirm(request);
        const duplicate = await service.confirm(request);

        expect(first.created).toBe(true);
        expect(duplicate.created).toBe(false);
        expect(await repositories.contacts.list()).toMatchObject([{
            participantId: 'participant-ali', contact: { email: 'ali@example.com' }
        }]);
        expect(JSON.stringify(first)).not.toContain('ali@example.com');
    });

    it('rejects confirmation coming from another participant', async () => {
        const events = createInMemoryConversationEventReader([
            event('candidate-1', 'contact_candidate', 'participant-ali', {
                field: 'email', candidateValue: 'ali@example.com'
            }),
            event('confirmation-1', 'contact_confirmed', 'participant-ayse', {
                field: 'email', candidateEventId: 'candidate-1', valueRef: 'candidate-1'
            })
        ]);
        const repositories = createInMemorySalesOutcomeRepositories();
        const service = createContactService({ repository: repositories.contacts, eventReader: events });

        await expect(service.confirm({
            input: {
                participantId: 'participant-ali', field: 'email',
                candidateValue: 'ali@example.com', sourceEventId: 'candidate-1',
                confirmationEventId: 'confirmation-1'
            },
            participantContext: aliContext,
            sessionContext
        })).rejects.toMatchObject({ code: 'contact_evidence_mismatch' });
    });
});

describe('meeting application service', () => {
    it('stores normalized time and all confirmed attendees idempotently', async () => {
        const attendees = ['participant-ali', 'participant-ayse'];
        const events = createInMemoryConversationEventReader([
            event('meeting-intent-1', 'meeting_intent', 'participant-ali', {
                originalPhrase: 'Perşembe saat üç', timezoneHint: 'Europe/Brussels'
            }),
            event('meeting-confirmation-1', 'meeting_confirmed', 'participant-ali', {
                intentEventId: 'meeting-intent-1',
                attendeeParticipantIds: attendees,
                startsAt: '2026-09-24T13:00:00.000Z',
                timezone: 'Europe/Brussels',
                durationMinutes: 30
            })
        ]);
        const repositories = createInMemorySalesOutcomeRepositories();
        const service = createMeetingService({ repository: repositories.meetings, eventReader: events });
        const request = {
            input: {
                attendeeParticipantIds: attendees,
                startsAt: '2026-09-24T13:00:00.000Z',
                timezone: 'Europe/Brussels',
                durationMinutes: 30,
                originalPhrase: 'Perşembe saat üç',
                sourceEventId: 'meeting-intent-1',
                confirmationEventId: 'meeting-confirmation-1'
            },
            participantContext: aliContext,
            sessionContext
        };

        expect((await service.confirm(request)).created).toBe(true);
        expect((await service.confirm(request)).created).toBe(false);
        expect(await repositories.meetings.list()).toMatchObject([{
            attendeeParticipantIds: attendees,
            timezone: 'Europe/Brussels',
            durationMinutes: 30
        }]);
    });
});

describe('follow-up application service', () => {
    it('keeps multiple consent-backed company questions as separate tasks', async () => {
        const events = createInMemoryConversationEventReader([
            event('question-1', 'company_question', 'participant-ali', {
                question: 'Veriler hangi ülkede?', forwardingConsentEventId: 'consent-1'
            }),
            event('consent-1', 'follow_up_consent_confirmed', 'participant-ali', {
                questionEventId: 'question-1'
            }),
            event('question-2', 'company_question', 'participant-ali', {
                question: 'Özel SLA sunuyor musunuz?', forwardingConsentEventId: 'consent-2'
            }),
            event('consent-2', 'follow_up_consent_confirmed', 'participant-ali', {
                questionEventId: 'question-2'
            })
        ]);
        const repositories = createInMemorySalesOutcomeRepositories();
        const service = createFollowUpService({ repository: repositories.followUps, eventReader: events });

        for (const [number, question] of [
            ['1', 'Veriler hangi ülkede?'],
            ['2', 'Özel SLA sunuyor musunuz?']
        ]) {
            await service.capture({
                input: {
                    requestedByParticipantId: 'participant-ali',
                    question,
                    category: 'product',
                    sourceEventId: `question-${number}`,
                    forwardingConsentEventId: `consent-${number}`
                },
                participantContext: aliContext,
                sessionContext
            });
        }

        expect(await repositories.followUps.list()).toHaveLength(2);
    });
});

describe('legacy contact projection', () => {
    it('prefers participant-aware contacts and falls back to legacy fields', () => {
        expect(projectSessionContacts({
            session: { confirmedContact: { email: 'legacy@example.com' } },
            leadContacts: [{ participantId: 'participant-1', contact: { email: 'new@example.com' } }]
        })).toEqual([{
            participantId: 'participant-1',
            contact: { email: 'new@example.com' },
            source: 'participant_contact'
        }]);
        expect(projectSessionContacts({
            session: {
                participants: [{ participantId: 'participant-legacy' }],
                confirmedContact: { name: 'Ali' }
            },
            lead: { contact: { email: 'legacy@example.com' } }
        })).toEqual([{
            participantId: 'participant-legacy',
            contact: { name: 'Ali', email: 'legacy@example.com' },
            source: 'legacy_adapter'
        }]);
    });
});
