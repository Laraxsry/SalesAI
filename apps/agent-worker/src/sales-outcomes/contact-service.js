import { ConfirmedContactInput } from '@repo/contracts';
import {
    SalesOutcomePolicyError,
    requireEvent,
    requireSessionContext,
    requireTrustedParticipant
} from './policy.js';

export function createContactService({ repository, eventReader, now = () => new Date() }) {
    if (!repository || typeof repository.upsertConfirmed !== 'function') {
        throw new TypeError('contact repository is required');
    }

    return Object.freeze({
        async confirm({ input, participantContext, sessionContext }) {
            const contact = ConfirmedContactInput.parse(input);
            const session = requireSessionContext(sessionContext);
            requireTrustedParticipant(participantContext, contact.participantId, session.sessionId);

            const [candidate, confirmation] = await Promise.all([
                requireEvent(eventReader, contact.sourceEventId, 'contact_candidate'),
                requireEvent(eventReader, contact.confirmationEventId, 'contact_confirmed')
            ]);
            if (candidate.participantId !== contact.participantId
                || confirmation.participantId !== contact.participantId
                || candidate.payload.field !== contact.field
                || candidate.payload.candidateValue !== contact.candidateValue
                || confirmation.payload.field !== contact.field
                || confirmation.payload.candidateEventId !== candidate.eventId) {
                throw new SalesOutcomePolicyError('contact_evidence_mismatch');
            }

            const persisted = await repository.upsertConfirmed({
                ...session,
                participantId: contact.participantId,
                field: contact.field,
                value: contact.candidateValue,
                sourceEventId: contact.sourceEventId,
                confirmationEventId: contact.confirmationEventId,
                confirmedAt: now()
            });
            return {
                ok: true,
                created: persisted.created,
                recordId: persisted.id,
                event: {
                    type: 'contact_field_persisted',
                    participantId: contact.participantId,
                    field: contact.field,
                    confirmationEventId: contact.confirmationEventId
                }
            };
        }
    });
}
