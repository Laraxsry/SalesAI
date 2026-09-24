import { describe, expect, it } from 'vitest';
import { decideAdaptiveSurveyActivation } from './adaptive-survey-activation.js';

const base = {
    featureEnabled: true, productConfigValid: true,
    rolloutDecision: { cohort: 'canary', dynamicStateEnabled: true },
    maxParticipants: 1
};

describe('adaptive survey activation', () => {
    it('uses the current session without environment ID allowlists', () => {
        expect(decideAdaptiveSurveyActivation(base))
            .toEqual({ enabled: true, reason: 'enabled_for_active_session' });
    });

    it('keeps shadow, group sessions, invalid config and kill-switch off', () => {
        expect(decideAdaptiveSurveyActivation({ ...base,
            featureEnabled: false }).reason).toBe('feature_disabled');
        expect(decideAdaptiveSurveyActivation({ ...base,
            productConfigValid: false }).reason).toBe('product_not_opted_in');
        expect(decideAdaptiveSurveyActivation({ ...base,
            rolloutDecision: { cohort: 'shadow', dynamicStateEnabled: true } }).reason)
            .toBe('not_canary');
        expect(decideAdaptiveSurveyActivation({ ...base,
            maxParticipants: 2 }).reason).toBe('group_session_unsupported');
    });
});
