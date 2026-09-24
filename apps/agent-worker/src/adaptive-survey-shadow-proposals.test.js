import { describe, expect, it } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createRulesShadowSurveyPlanner } from './rules-shadow-survey-planner.js';
import { createAdaptiveSurveyShadowProposalService }
    from './adaptive-survey-shadow-proposals.js';

const fields = [{ key: 'company.industry', importance: 'recommended',
    affects: ['demo_route'], preferredInput: 'single_select' }];

function store() {
    const stateStore = createDynamicPlaybookStore({
        sessionId: 'shadow-session',
        contract: compileLegacyPlaybook([{ id: 'intro', order: 1,
            type: 'narrative', directive: 'Tanıt', mode: 'situational',
            url: null, actions: [], survey: null }], { contractId: 'contract' })
    });
    stateStore.dispatch({ type: 'MEMORY_TURN_ADVANCED' });
    return stateStore;
}

function resolver(status = 'unknown') {
    return { resolve: async ({ key }) => ({
        key, status, fact: null, candidates: [], reason: 'test_resolution'
    }) };
}

describe('rules-based shadow survey proposals', () => {
    it('evaluates a full proposal without dispatching or opening a survey', async () => {
        const stateStore = store();
        const before = stateStore.snapshot();
        const decisions = [];
        const service = createAdaptiveSurveyShadowProposalService({
            store: stateStore, planner: createRulesShadowSurveyPlanner(),
            knownFactResolver: resolver(), fields, policy: { enabled: true },
            onDecision: (decision) => decisions.push(decision)
        });
        expect(await service.evaluateCandidate('company.industry')).toMatchObject({
            status: 'approved', reason: 'policy_passed'
        });
        expect(stateStore.snapshot()).toBe(before);
        expect(stateStore.snapshot().adaptiveSurvey.activeSurveyId).toBeNull();
        expect(decisions).toHaveLength(1);
        expect(await service.evaluateCandidate('company.industry')).toBeNull();
    });

    it('uses the deterministic gate to reject a newly known fact', async () => {
        const service = createAdaptiveSurveyShadowProposalService({
            store: store(), planner: createRulesShadowSurveyPlanner(),
            knownFactResolver: resolver('known'), fields, policy: { enabled: true }
        });
        expect(await service.evaluateCandidate('company.industry')).toMatchObject({
            status: 'rejected', reason: 'fact_already_known'
        });
    });

    it('ignores stale proposals and never substitutes another field', async () => {
        const stateStore = store();
        let release;
        const service = createAdaptiveSurveyShadowProposalService({
            store: stateStore, fields, policy: { enabled: true },
            planner: { propose: () => new Promise((resolve) => { release = resolve; }) },
            knownFactResolver: resolver()
        });
        const pending = service.evaluateCandidate('company.industry');
        stateStore.dispatch({ type: 'MEMORY_TURN_ADVANCED' });
        release(await createRulesShadowSurveyPlanner().propose({ field: fields[0],
            routeRevision: 0, epoch: 0, turnIndex: 1 }));
        expect(await pending).toMatchObject({
            status: 'ignored', reason: 'stale_shadow_context'
        });
        expect(await service.evaluateCandidate('customer.primary_goal')).toBeNull();
    });

    it('fails closed when a template cannot satisfy the authored input type', async () => {
        const service = createAdaptiveSurveyShadowProposalService({
            store: store(), planner: createRulesShadowSurveyPlanner(),
            knownFactResolver: resolver(), policy: { enabled: true },
            fields: [{ ...fields[0], preferredInput: 'short_text' }]
        });
        expect(await service.evaluateCandidate('company.industry')).toMatchObject({
            status: 'rejected', reason: 'invalid_shadow_proposal'
        });
    });
});
