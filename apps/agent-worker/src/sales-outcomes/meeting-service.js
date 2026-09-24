import { ConfirmedMeetingInput } from '@repo/contracts';
import {
    SalesOutcomePolicyError,
    requireEvent,
    requireSessionContext,
    requireTrustedParticipant,
    sameMembers
} from './policy.js';

export function createMeetingService({ repository, eventReader, now = () => new Date() }) {
    if (!repository || typeof repository.saveConfirmed !== 'function') {
        throw new TypeError('meeting repository is required');
    }

    return Object.freeze({
        async confirm({ input, participantContext, sessionContext }) {
            const meeting = ConfirmedMeetingInput.parse(input);
            const session = requireSessionContext(sessionContext);
            requireTrustedParticipant(participantContext, participantContext?.participantId, session.sessionId);
            if (!meeting.attendeeParticipantIds.includes(participantContext.participantId)) {
                throw new SalesOutcomePolicyError('confirmer_not_an_attendee');
            }
            if (session.participantIds.length === 0
                || meeting.attendeeParticipantIds.some((id) => !session.participantIds.includes(id))) {
                throw new SalesOutcomePolicyError('unknown_meeting_attendee');
            }

            const [intent, confirmation] = await Promise.all([
                requireEvent(eventReader, meeting.sourceEventId, 'meeting_intent'),
                requireEvent(eventReader, meeting.confirmationEventId, 'meeting_confirmed')
            ]);
            if (intent.participantId !== participantContext.participantId
                || confirmation.participantId !== participantContext.participantId
                || confirmation.payload.intentEventId !== intent.eventId
                || confirmation.payload.startsAt !== meeting.startsAt
                || confirmation.payload.timezone !== meeting.timezone
                || confirmation.payload.durationMinutes !== meeting.durationMinutes
                || !sameMembers(confirmation.payload.attendeeParticipantIds, meeting.attendeeParticipantIds)) {
                throw new SalesOutcomePolicyError('meeting_evidence_mismatch');
            }

            const persisted = await repository.saveConfirmed({
                ...session,
                attendeeParticipantIds: meeting.attendeeParticipantIds,
                startsAt: new Date(meeting.startsAt),
                timezone: meeting.timezone,
                durationMinutes: meeting.durationMinutes,
                originalPhrase: meeting.originalPhrase,
                sourceEventId: meeting.sourceEventId,
                confirmationEventId: meeting.confirmationEventId,
                confirmedAt: now()
            });
            return {
                ok: true,
                created: persisted.created,
                recordId: persisted.id,
                event: {
                    type: 'meeting_persisted',
                    attendeeParticipantIds: meeting.attendeeParticipantIds,
                    confirmationEventId: meeting.confirmationEventId
                }
            };
        }
    });
}
