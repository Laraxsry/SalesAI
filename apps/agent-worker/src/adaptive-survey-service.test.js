import { describe, expect, it } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createAdaptiveSurveyService } from './adaptive-survey-service.js';

function store() {
    return createDynamicPlaybookStore({
        sessionId: 'session',
        contract: compileLegacyPlaybook([{
            id: 'intro', order: 1, type: 'narrative', directive: 'Tanıt',
            url: null, actions: [], mode: 'situational', survey: null
        }], { contractId: 'contract' })
    });
}

function proposal(overrides = {}) {
    return {
        proposalId: 'industry-1', baseRevision: 0, epoch: 0,
        purpose: 'demo_routing', questionKey: 'company.industry',
        question: 'Hangi sektörde çalışıyorsunuz?', reason: 'Demo rotasını belirler.',
        answerType: 'single_select',
        options: [{ value: 'finance', label: 'Finans' }, { value: 'saas', label: 'SaaS' }],
        requiredFor: ['demo_route'], blocking: false, confidenceThatUnknown: 0.95,
        ...overrides
    };
}

const unknownResolver = {
    resolve: async ({ key }) => ({
        key, status: 'unknown', fact: null, candidates: [], reason: 'no_known_fact'
    })
};
const allowedFields = [{
    key: 'company.industry', importance: 'recommended',
    affects: ['demo_route'], preferredInput: 'single_select'
}];

describe('adaptive survey service', () => {
    it('records an approved proposal without opening the survey', async () => {
        const stateStore = store();
        const decisions = [];
        const service = createAdaptiveSurveyService({
            store: stateStore,
            knownFactResolver: unknownResolver,
            fieldDefinitions: allowedFields,
            onDecision: (decision) => decisions.push(decision)
        });
        const result = await service.review(proposal());

        expect(result.decision.status).toBe('approved');
        expect(result.state.adaptiveSurvey).toMatchObject({
            activeSurveyId: null,
            shownCount: 0,
            approvedProposal: { proposalId: 'industry-1' },
            lastDecision: { status: 'approved', channel: 'survey' }
        });
        expect(decisions[0]).toMatchObject({
            questionKey: 'company.industry', factStatus: 'unknown'
        });
    });

    it('rejects a proposal that becomes stale during async fact lookup', async () => {
        const stateStore = store();
        let release;
        const resolver = {
            resolve: () => new Promise((resolve) => { release = resolve; })
        };
        const service = createAdaptiveSurveyService({
            store: stateStore, knownFactResolver: resolver, fieldDefinitions: allowedFields
        });
        const pending = service.review(proposal());
        stateStore.dispatch({ type: 'PLANNING_STARTED', reason: 'customer_changed_topic' });
        stateStore.dispatch({
            type: 'ROUTE_REVISION_ACCEPTED', baseRevision: 0, planningGeneration: 1,
            reason: 'customer_changed_topic', nodes: stateStore.snapshot().route
        });
        release({
            key: 'company.industry', status: 'unknown', fact: null,
            candidates: [], reason: 'no_known_fact'
        });
        const result = await pending;

        expect(result.decision).toMatchObject({
            status: 'rejected', reason: 'stale_route_revision'
        });
        expect(stateStore.snapshot().adaptiveSurvey).toMatchObject({
            epoch: 1, approvedProposal: null, lastDecision: null
        });
    });

    it('fails safely when the fact resolver throws', async () => {
        const service = createAdaptiveSurveyService({
            store: store(), fieldDefinitions: allowedFields,
            knownFactResolver: { resolve: async () => { throw new Error('offline'); } }
        });
        const result = await service.review(proposal());
        expect(result.decision).toMatchObject({
            status: 'deferred', reason: 'fact_source_unavailable'
        });
    });

    it('keeps reviewer advice separate from deterministic approval', async () => {
        const decisions = [];
        const service = createAdaptiveSurveyService({
            store: store(), fieldDefinitions: allowedFields,
            knownFactResolver: unknownResolver,
            reviewers: { review: async () => [{ id: 'critic', status: 'flagged' }] },
            onDecision: (decision) => decisions.push(decision)
        });
        const result = await service.review(proposal());
        expect(result.decision.status).toBe('approved');
        expect(result.reviews).toEqual([{ id: 'critic', status: 'flagged' }]);
        expect(decisions[0].reviewStatuses).toEqual(['critic:flagged']);
    });

    it('defers if a known fact arrives while an advisory reviewer is waiting', async () => {
        const stateStore = store();
        let release;
        const service = createAdaptiveSurveyService({
            store: stateStore, fieldDefinitions: allowedFields,
            knownFactResolver: unknownResolver,
            reviewers: { review: () => new Promise((resolve) => { release = resolve; }) }
        });
        const pending = service.review(proposal());
        await Promise.resolve();
        stateStore.dispatch({ type: 'FACT_DISCOVERED', fact: {
            key: 'company.industry', value: 'saas', source: 'conversation', confidence: 1
        } });
        release([]);
        const result = await pending;
        expect(result.decision).toMatchObject({
            status: 'deferred', reason: 'fact_source_unavailable'
        });
    });
});
