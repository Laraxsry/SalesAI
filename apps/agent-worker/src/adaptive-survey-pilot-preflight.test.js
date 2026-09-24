import { describe, expect, it } from 'vitest';
import { evaluateAdaptiveSurveyPilotPreflight } from './adaptive-survey-pilot-preflight.js';

const plan = {
    phase: 'bootstrap', sessionId: 'sample-session', agentId: 'agent-a',
    productId: 'product-a', maxParticipants: 1,
    productAdaptiveSurvey: {
        enabled: true,
        policy: { enabled: true },
        fields: [{ key: 'company.industry', importance: 'recommended',
            affects: ['demo_route'], preferredInput: 'single_select' }]
    },
    dynamicRollout: { mode: 'canary', canaryPercent: 100 },
    survey: { enabled: true }
};

describe('adaptive survey pilot preflight', () => {
    it('simulates a narrow bootstrap without requiring evidence that does not exist yet', () => {
        expect(evaluateAdaptiveSurveyPilotPreflight(plan)).toMatchObject({
            phase: 'bootstrap', simulationOnly: true, checksPassed: true,
            rolloutAuthorized: false, observedCohort: 'canary', configuredFieldCount: 1,
            blockers: []
        });
    });

    it('blocks expansion without both operational and human evidence', () => {
        const result = evaluateAdaptiveSurveyPilotPreflight({ ...plan, phase: 'expand' });
        expect(result.checksPassed).toBe(false);
        expect(result.blockers).toEqual([
            'pilot_corpus_scope', 'operational_evidence', 'human_review_evidence'
        ]);
        expect(evaluateAdaptiveSurveyPilotPreflight({ ...plan, phase: 'expand' }, {
            operationalReadiness: { operationalChecksPassed: true },
            humanReview: { checksPassed: true }, corpusScopeMatched: true
        })).toMatchObject({ checksPassed: true, rolloutAuthorized: false });
    });

    it('fails when product opt-in is missing', () => {
        expect(evaluateAdaptiveSurveyPilotPreflight({
            ...plan, productAdaptiveSurvey: null
        }).blockers).toContain('survey_activation_eligible');
    });

    it('uses percentage-based canary selection without ID scope', () => {
        const result = evaluateAdaptiveSurveyPilotPreflight({
            ...plan,
            dynamicRollout: { mode: 'canary', canaryPercent: 100 }
        });
        expect(result.observedCohort).toBe('canary');
        expect(result.checksPassed).toBe(true);
    });

    it('rejects unsafe or incomplete simulation inputs', () => {
        expect(() => evaluateAdaptiveSurveyPilotPreflight({ ...plan, sessionId: '' }))
            .toThrow(/invalid pilot/);
        expect(() => evaluateAdaptiveSurveyPilotPreflight({
            ...plan, dynamicRollout: { ...plan.dynamicRollout, canaryPercent: 150 }
        })).toThrow(/canaryPercent/);
    });
});
