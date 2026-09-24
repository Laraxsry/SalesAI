import { describe, expect, it, vi } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createAdaptiveSurveyProducer } from './adaptive-survey-producer.js';
import { resolveAdaptiveSurveyConfig } from './adaptive-survey-config.js';

const field = {
    key: 'company.industry', importance: 'recommended',
    affects: ['demo_route'], preferredInput: 'single_select'
};
const input = {
    questionKey: 'company.industry', purpose: 'demo_routing',
    question: 'Hangi sektörde çalışıyorsunuz?', reason: 'Demo seçimi için',
    answerType: 'single_select',
    options: [{ value: 'saas', label: 'SaaS' }, { value: 'finance', label: 'Finans' }]
};

function setup(canPresent = () => true) {
    const store = createDynamicPlaybookStore({
        sessionId: 's1', contract: compileLegacyPlaybook([], { contractId: 'c1' })
    });
    const review = vi.fn(async (proposal) => ({
        decision: { status: 'approved', channel: 'survey' }, proposal
    }));
    const present = vi.fn(async () => ({ ok: true }));
    const producer = createAdaptiveSurveyProducer({
        store, fields: [field], review, present, canPresent, idFactory: () => 'proposal-1'
    });
    return { producer, review, present };
}

describe('adaptive survey producer', () => {
    it('requires explicit opt-in and a valid field allowlist', () => {
        expect(resolveAdaptiveSurveyConfig(null, true)).toBeNull();
        expect(resolveAdaptiveSurveyConfig({ enabled: true, fields: [field] }, false)).toBeNull();
        expect(resolveAdaptiveSurveyConfig({ enabled: true, fields: [field] }, true))
            .toMatchObject({ fields: [field], policy: { enabled: true } });
        expect(resolveAdaptiveSurveyConfig({ enabled: true, fields: [field, field] }, true)).toBeNull();
        expect(resolveAdaptiveSurveyConfig({ enabled: true, fields: [field],
            policy: { maxPerSession: 0 } }, true)).toBeNull();
        expect(resolveAdaptiveSurveyConfig({ enabled: true, fields: [{
            ...field, preferredInput: 'voice'
        }] }, true)).toBeNull();
    });

    it('queues a bounded proposal and waits until answer delivery to review and show', async () => {
        const { producer, review, present } = setup();
        expect(producer.propose(input)).toEqual({ status: 'queued', reason: 'awaiting_answer_delivery' });
        expect(review).not.toHaveBeenCalled();
        expect(present).not.toHaveBeenCalled();
        expect(await producer.answerDelivered()).toMatchObject({ status: 'opened' });
        expect(review.mock.calls[0][0]).toMatchObject({
            proposalId: 'proposal-1', baseRevision: 0, epoch: 0,
            requiredFor: ['demo_route'], blocking: false
        });
        expect(present).toHaveBeenCalledOnce();
    });

    it('rejects unapproved fields and wrong answer types before queueing', () => {
        const { producer } = setup();
        expect(producer.propose({ ...input, questionKey: 'customer.password' }).reason)
            .toBe('field_not_allowlisted');
        expect(producer.propose({ ...input, answerType: 'short_text', options: [] }).reason)
            .toBe('answer_type_mismatch');
    });

    it('does not show while the customer has the floor or after interruption', async () => {
        let ready = false;
        const { producer, review, present } = setup(() => ready);
        producer.propose(input);
        expect(await producer.answerDelivered()).toMatchObject({ status: 'deferred' });
        expect(review).not.toHaveBeenCalled();
        producer.cancel();
        ready = true;
        expect(await producer.answerDelivered()).toMatchObject({ status: 'idle' });
        expect(present).not.toHaveBeenCalled();
    });

    it('drops an in-flight review when the customer interrupts', async () => {
        let resolveReview;
        const { producer, review, present } = setup();
        review.mockImplementation(() => new Promise((resolve) => { resolveReview = resolve; }));
        producer.propose(input);
        const pending = producer.answerDelivered();
        producer.cancel();
        resolveReview({ decision: { status: 'approved', channel: 'survey' } });
        expect(await pending).toMatchObject({ status: 'deferred' });
        expect(present).not.toHaveBeenCalled();
    });
});
