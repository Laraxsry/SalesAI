import { FollowUpQuestionInput } from '@repo/contracts';
import {
    SalesOutcomePolicyError,
    requireEvent,
    requireSessionContext,
    requireTrustedParticipant
} from './policy.js';

export function createFollowUpService({ repository, eventReader, now = () => new Date() }) {
    if (!repository || typeof repository.createFromQuestion !== 'function') {
        throw new TypeError('follow-up repository is required');
    }

    return Object.freeze({
        async capture({ input, participantContext, sessionContext }) {
            const followUp = FollowUpQuestionInput.parse(input);
            const session = requireSessionContext(sessionContext);
            requireTrustedParticipant(
                participantContext,
                followUp.requestedByParticipantId,
                session.sessionId
            );

            const [question, consent] = await Promise.all([
                requireEvent(eventReader, followUp.sourceEventId, 'company_question'),
                requireEvent(eventReader, followUp.forwardingConsentEventId, 'follow_up_consent_confirmed')
            ]);
            if (question.participantId !== followUp.requestedByParticipantId
                || consent.participantId !== followUp.requestedByParticipantId
                || question.payload.question !== followUp.question
                || consent.payload.questionEventId !== question.eventId
                || (question.payload.forwardingConsentEventId
                    && question.payload.forwardingConsentEventId !== consent.eventId)) {
                throw new SalesOutcomePolicyError('follow_up_evidence_mismatch');
            }

            const persisted = await repository.createFromQuestion({
                ...session,
                requestedByParticipantId: followUp.requestedByParticipantId,
                question: followUp.question,
                category: followUp.category,
                sourceEventId: followUp.sourceEventId,
                forwardingConsentEventId: followUp.forwardingConsentEventId,
                createdAt: now()
            });
            return {
                ok: true,
                created: persisted.created,
                recordId: persisted.id,
                event: {
                    type: 'follow_up_task_persisted',
                    requestedByParticipantId: followUp.requestedByParticipantId,
                    category: followUp.category,
                    sourceEventId: followUp.sourceEventId
                }
            };
        }
    });
}
