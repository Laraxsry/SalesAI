import { randomUUID } from 'node:crypto';
import { SurveyProposalInput } from '@repo/contracts';

/** Model proposal intake and answer-first scheduler; no direct state writes. */
export function createAdaptiveSurveyProducer({
    store, fields, review, present, canPresent, onEvent = () => {}, idFactory = randomUUID
}) {
    let pending = null;
    let draining = false;
    let generation = 0;

    function report(event, detail = {}) {
        try { onEvent(event, detail); } catch { /* telemetry cannot decide */ }
    }

    return {
        propose(input) {
            if (pending || draining) return { status: 'rejected', reason: 'proposal_already_pending' };
            const field = fields.find((candidate) => candidate.key === input?.questionKey);
            if (!field || field.importance === 'do_not_ask') {
                return { status: 'rejected', reason: 'field_not_allowlisted' };
            }
            const state = store.snapshot();
            const proposal = SurveyProposalInput.safeParse({
                ...input,
                proposalId: idFactory(),
                baseRevision: state.routeRevision,
                epoch: state.adaptiveSurvey.epoch,
                requiredFor: field.affects,
                blocking: false,
                confidenceThatUnknown: 1
            });
            if (!proposal.success) return { status: 'rejected', reason: 'invalid_proposal' };
            if (field.preferredInput === 'voice') {
                return { status: 'rejected', reason: 'field_prefers_voice' };
            }
            if (field.preferredInput && field.preferredInput !== proposal.data.answerType) {
                return { status: 'rejected', reason: 'answer_type_mismatch' };
            }
            pending = proposal.data;
            report('queued', { proposalId: pending.proposalId, questionKey: pending.questionKey });
            return { status: 'queued', reason: 'awaiting_answer_delivery' };
        },

        async answerDelivered() {
            if (!pending || draining) return { status: 'idle' };
            if (!canPresent()) return { status: 'deferred', reason: 'customer_has_floor' };
            draining = true;
            const startedGeneration = generation;
            const proposal = pending;
            pending = null;
            try {
                const { decision } = await review(proposal, { hasOpenCustomerQuestion: !canPresent() });
                if (decision.status !== 'approved' || decision.channel !== 'survey') return decision;
                if (startedGeneration !== generation || !canPresent()) {
                    report('deferred', { proposalId: proposal.proposalId, reason: 'customer_has_floor' });
                    return { status: 'deferred', reason: 'customer_has_floor' };
                }
                const opened = await present();
                return opened.ok
                    ? { status: 'opened', proposalId: proposal.proposalId }
                    : { status: 'rejected', reason: opened.reason };
            } catch {
                report('failed', { proposalId: proposal.proposalId });
                return { status: 'rejected', reason: 'producer_failed' };
            } finally {
                draining = false;
            }
        },

        cancel(reason = 'customer_interrupted') {
            generation++;
            if (!pending) return;
            report('cancelled', { proposalId: pending.proposalId, reason });
            pending = null;
        }
    };
}
