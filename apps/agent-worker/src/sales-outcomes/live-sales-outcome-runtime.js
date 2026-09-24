import { randomUUID } from 'node:crypto';
import { ConversationEventInput } from '@repo/contracts';
import { createContactService } from './contact-service.js';
import { createMeetingService } from './meeting-service.js';
import { createFollowUpService } from './follow-up-service.js';

/**
 * Typed live-call façade. Tools may request an outcome, but these services and
 * their evidence checks remain the only persistence authority.
 */
export function createLiveSalesOutcomeRuntime({
    repositories,
    sessionContext,
    participantRegistry,
    getParticipantContext,
    publishAnalysis = () => null,
    createEventId = () => randomUUID(),
    now = () => Date.now()
}) {
    const events = new Map();
    const eventReader = { getById: async (eventId) => events.get(eventId) ?? null };
    const contacts = createContactService({ repository: repositories.contacts, eventReader });
    const meetings = createMeetingService({ repository: repositories.meetings, eventReader });
    const followUps = createFollowUpService({ repository: repositories.followUps, eventReader });
    let turnIndex = 0;

    function context() {
        const participant = getParticipantContext?.();
        if (!participant?.participantId) return null;
        return participant;
    }

    function event(type, participantId, payload) {
        const value = ConversationEventInput.parse({
            eventId: createEventId(),
            type,
            sessionId: sessionContext.sessionId,
            participantId,
            turnIndex: ++turnIndex,
            routeRevision: 0,
            occurredAt: new Date(now()).toISOString(),
            payload
        });
        events.set(value.eventId, value);
        return value;
    }

    return Object.freeze({
        async confirmContact({ field, value }) {
            const participant = context();
            if (!participant) return { ok: false, error: 'trusted_participant_required' };
            const candidate = event('contact_candidate', participant.participantId, {
                field, candidateValue: value
            });
            const confirmation = event('contact_confirmed', participant.participantId, {
                field, candidateEventId: candidate.eventId, valueRef: candidate.eventId
            });
            return contacts.confirm({
                input: {
                    participantId: participant.participantId,
                    field,
                    candidateValue: value,
                    sourceEventId: candidate.eventId,
                    confirmationEventId: confirmation.eventId
                },
                participantContext: participant,
                sessionContext
            });
        },

        async confirmMeeting({ startsAt, timezone, durationMinutes, originalPhrase }) {
            const participant = context();
            if (!participant) return { ok: false, error: 'trusted_participant_required' };
            const attendeeParticipantIds = participantRegistry.list()
                .filter((entry) => entry.connected)
                .map((entry) => entry.participantId);
            const intent = event('meeting_intent', participant.participantId, {
                originalPhrase, timezoneHint: timezone
            });
            const confirmation = event('meeting_confirmed', participant.participantId, {
                intentEventId: intent.eventId,
                attendeeParticipantIds,
                startsAt,
                timezone,
                durationMinutes
            });
            return meetings.confirm({
                input: {
                    attendeeParticipantIds,
                    startsAt,
                    timezone,
                    durationMinutes,
                    originalPhrase,
                    sourceEventId: intent.eventId,
                    confirmationEventId: confirmation.eventId
                },
                participantContext: participant,
                sessionContext: {
                    ...sessionContext,
                    participantIds: participantRegistry.list().map((entry) => entry.participantId)
                }
            });
        },

        async captureFollowUp({ question }) {
            const participant = context();
            if (!participant) return { ok: false, error: 'trusted_participant_required' };
            const consentEventId = createEventId();
            const questionEvent = event('company_question', participant.participantId, {
                question, forwardingConsentEventId: consentEventId
            });
            const consentEvent = ConversationEventInput.parse({
                eventId: consentEventId,
                type: 'follow_up_consent_confirmed',
                sessionId: sessionContext.sessionId,
                participantId: participant.participantId,
                turnIndex: ++turnIndex,
                routeRevision: 0,
                occurredAt: new Date(now()).toISOString(),
                payload: { questionEventId: questionEvent.eventId }
            });
            events.set(consentEvent.eventId, consentEvent);

            const settled = await publishAnalysis(questionEvent);
            const results = settled?.flatMap((entry) => entry.status === 'fulfilled'
                ? entry.value ?? [] : []) ?? [];
            const classification = results.find((result) =>
                result.status === 'accepted'
                && result.proposal?.proposalType === 'follow_up_classification');
            return followUps.capture({
                input: {
                    requestedByParticipantId: participant.participantId,
                    question,
                    category: classification?.proposal.payload.category ?? null,
                    sourceEventId: questionEvent.eventId,
                    forwardingConsentEventId: consentEvent.eventId
                },
                participantContext: participant,
                sessionContext
            });
        }
    });
}
