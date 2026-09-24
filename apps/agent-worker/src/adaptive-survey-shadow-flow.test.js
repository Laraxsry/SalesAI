import { describe, expect, it } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createAdaptiveSurveyShadowObserver }
    from './adaptive-survey-shadow-observer.js';
import { createRulesShadowSurveyPlanner } from './rules-shadow-survey-planner.js';
import { createAdaptiveSurveyShadowProposalService }
    from './adaptive-survey-shadow-proposals.js';
import { sanitizeReplaySession } from './replay-fixture-sanitizer.js';
import { evaluateDynamicPlaybookTimeline } from './dynamic-playbook-eval.js';
import { aggregateAdaptiveSurveyShadowReports } from './adaptive-survey-shadow-report.js';
import { TIMELINE_EVENTS } from './session-timeline.js';

describe('customer-invisible shadow proposal flow', () => {
    it('observes, validates and replays a proposal without mutating the session', async () => {
        const store = createDynamicPlaybookStore({
            sessionId: 'shadow-flow-session',
            contract: compileLegacyPlaybook([{ id: 'intro', order: 1,
                type: 'narrative', directive: 'Tanıt', mode: 'situational',
                url: null, actions: [], survey: null }], { contractId: 'contract' })
        });
        store.dispatch({ type: 'MEMORY_TURN_ADVANCED' });
        const before = store.snapshot();
        const fields = [{ key: 'company.industry', importance: 'recommended',
            affects: ['demo_route'], preferredInput: 'single_select' }];
        const resolver = { resolve: async ({ key }) => ({ key, status: 'unknown',
            fact: null, candidates: [], reason: 'no_known_fact' }) };
        const events = [];
        const emit = (type, meta) => events.push({ seq: events.length + 1, type, meta });
        const observer = createAdaptiveSurveyShadowObserver({
            store, fields, knownFactResolver: resolver,
            onObservation: (value) => emit(
                TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_OBSERVATION, value
            )
        });
        const proposals = createAdaptiveSurveyShadowProposalService({
            store, fields, knownFactResolver: resolver,
            planner: createRulesShadowSurveyPlanner(), policy: { enabled: true },
            onDecision: (value) => emit(TIMELINE_EVENTS.ADAPTIVE_SURVEY_SHADOW_PROPOSAL, value)
        });
        for (const observation of await observer.observe()) {
            if (observation.status === 'unknown_field_candidate') {
                await proposals.evaluateCandidate(observation.questionKey);
            }
        }

        expect(store.snapshot()).toBe(before);
        expect(store.snapshot().adaptiveSurvey.activeSurveyId).toBeNull();
        const fixture = sanitizeReplaySession({ sessionId: 'shadow-flow-session', events }, {
            salt: 'shadow-flow-anonymization-salt'
        });
        expect(JSON.stringify(fixture)).not.toContain('company.industry');
        const report = evaluateDynamicPlaybookTimeline(fixture.events);
        expect(report.adaptiveSurveyShadow).toMatchObject({
            observations: 1, proposals: 1, proposalStatuses: { approved: 1 }
        });
        expect(aggregateAdaptiveSurveyShadowReports([{ sessionId: fixture.fixtureId, ...report }]))
            .toMatchObject({ sessions: 1, proposals: 1 });
    });
});
