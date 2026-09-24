import { describe, expect, it, vi } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createAdaptiveSurveyRuntime } from './adaptive-survey-runtime.js';

function approvedStore(answerType = 'single_select') {
    const store = createDynamicPlaybookStore({
        sessionId: 'session',
        contract: compileLegacyPlaybook([], { contractId: 'contract' })
    });
    const proposal = {
        proposalId: 'industry-1', baseRevision: 0, epoch: 0,
        purpose: 'demo_routing', questionKey: 'company.industry',
        question: 'Sektörünüz nedir?', reason: 'Demo rotasını belirler.', answerType,
        options: answerType.includes('select')
            ? [{ value: 'finance', label: 'Finans' }, { value: 'saas', label: 'SaaS' }]
            : [],
        requiredFor: ['demo_route'], blocking: false, confidenceThatUnknown: 0.9
    };
    store.dispatch({
        type: 'SURVEY_PROPOSAL_REVIEWED', proposal,
        decision: { status: 'approved', reason: 'policy_passed', channel: 'survey' }
    });
    return store;
}

describe('adaptive survey runtime', () => {
    it('opens only an approved proposal and persists before closing', async () => {
        const store = approvedStore();
        const order = [];
        const publish = vi.fn(async (payload) => { order.push(payload.action); });
        const runtime = createAdaptiveSurveyRuntime({
            store,
            publish,
            persistAnswer: async () => { order.push('persist'); return { ok: true }; },
            acknowledge: async () => { order.push('ack'); },
            replan: async () => { order.push('replan'); },
            setTimer: () => 1,
            clearTimer: () => {}
        });
        expect(await runtime.presentApproved()).toMatchObject({ ok: true });
        expect(store.snapshot().adaptiveSurvey.activeSurveyId).toBe('industry-1');
        const result = await runtime.answer({
            proposalId: 'industry-1', answerId: 'answer-1', value: 'saas'
        });

        expect(result).toEqual({ ok: true, skipped: false, duplicate: false });
        expect(order).toEqual(['show', 'persist', 'hide', 'ack', 'replan']);
        expect(store.snapshot().adaptiveSurvey.activeSurveyId).toBeNull();
        expect(store.snapshot().memory.discoveredFacts['company.industry']).toMatchObject({
            value: 'saas', source: 'survey', confidence: 1
        });
    });

    it('keeps an invalid answer open and never persists it', async () => {
        const store = approvedStore();
        const persistAnswer = vi.fn();
        const runtime = createAdaptiveSurveyRuntime({
            store, publish: async () => {}, persistAnswer, setTimer: () => 1, clearTimer: () => {}
        });
        await runtime.presentApproved();
        expect(await runtime.answer({ proposalId: 'industry-1', value: 'invented' }))
            .toEqual({ ok: false, reason: 'invalid_option' });
        expect(persistAnswer).not.toHaveBeenCalled();
        expect(store.snapshot().adaptiveSurvey.activeSurveyId).toBe('industry-1');
    });

    it('cleans up an interrupted survey without recording a refusal', async () => {
        const store = approvedStore();
        const published = [];
        const runtime = createAdaptiveSurveyRuntime({
            store,
            publish: async (payload) => { published.push(payload); },
            persistAnswer: async () => ({ ok: true }),
            setTimer: () => 1,
            clearTimer: () => {}
        });
        await runtime.presentApproved();
        await runtime.cancel('customer_interrupted');

        expect(store.snapshot().adaptiveSurvey.activeSurveyId).toBeNull();
        expect(store.snapshot().memory.askedQuestions['company.industry'].status).toBe('cancelled');
        expect(published.at(-1)).toMatchObject({ action: 'hide', reason: 'customer_interrupted' });
    });

    it('marks explicit dismissal as terminal and does not replan', async () => {
        const store = approvedStore('short_text');
        const replan = vi.fn();
        const runtime = createAdaptiveSurveyRuntime({
            store, publish: async () => {}, persistAnswer: async () => ({ ok: true }),
            replan, setTimer: () => 1, clearTimer: () => {}
        });
        await runtime.presentApproved();
        await runtime.answer({ proposalId: 'industry-1', answerId: 'skip-1', skipped: true });
        expect(store.snapshot().memory.askedQuestions['company.industry'].status).toBe('dismissed');
        expect(replan).not.toHaveBeenCalled();
    });

    it('keeps the survey open when persistence fails', async () => {
        const store = approvedStore();
        const runtime = createAdaptiveSurveyRuntime({
            store, publish: async () => {}, persistAnswer: async () => { throw new Error('db down'); },
            setTimer: () => 1, clearTimer: () => {}
        });
        await runtime.presentApproved();
        expect(await runtime.answer({ proposalId: 'industry-1', answerId: 'a1', value: 'saas' }))
            .toEqual({ ok: false, reason: 'persistence_failed' });
        expect(runtime.isActive('industry-1')).toBe(true);
        expect(store.snapshot().memory.discoveredFacts['company.industry']).toBeUndefined();
    });

    it('validates multi-select answers and exposes a resync payload only while active', async () => {
        const store = approvedStore('multi_select');
        const runtime = createAdaptiveSurveyRuntime({
            store, publish: async () => {}, persistAnswer: async () => ({ ok: true }),
            setTimer: () => 1, clearTimer: () => {}
        });
        await runtime.presentApproved();
        expect(runtime.activePayload()).toMatchObject({ mode: 'adaptive', answerType: 'multi_select' });
        expect(await runtime.answer({ proposalId: 'industry-1', answerId: 'a1', value: ['unknown'] }))
            .toEqual({ ok: false, reason: 'invalid_options' });
        expect((await runtime.answer({
            proposalId: 'industry-1', answerId: 'a1', value: ['finance', 'saas']
        })).ok).toBe(true);
        expect(runtime.activePayload()).toBeNull();
    });

    it('rejects an empty number instead of persisting it as zero', async () => {
        const store = approvedStore('number');
        const persistAnswer = vi.fn();
        const runtime = createAdaptiveSurveyRuntime({
            store, publish: async () => {}, persistAnswer,
            setTimer: () => 1, clearTimer: () => {}
        });
        await runtime.presentApproved();
        expect(await runtime.answer({ proposalId: 'industry-1', answerId: 'a1', value: '' }))
            .toEqual({ ok: false, reason: 'answer_required' });
        expect(persistAnswer).not.toHaveBeenCalled();
    });
});
