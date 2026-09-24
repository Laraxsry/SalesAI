import { describe, expect, it } from 'vitest';
import { createAdaptiveSurveyPilotScope } from './adaptive-survey-pilot-scope.js';

describe('adaptive survey pilot scope', () => {
    const salt = 'private-test-salt-long-enough';

    it('binds an agent-product pair without exposing either identifier', () => {
        const scope = createAdaptiveSurveyPilotScope({ agentId: 'agent-a',
            productId: 'product-a', salt });
        expect(scope).toMatch(/^pilot_scope:anon:[a-f0-9]{32}$/);
        expect(scope).not.toMatch(/agent-a|product-a/);
        expect(createAdaptiveSurveyPilotScope({ agentId: 'agent-a',
            productId: 'product-a', salt })).toBe(scope);
        expect(createAdaptiveSurveyPilotScope({ agentId: 'agent-a',
            productId: 'product-b', salt })).not.toBe(scope);
    });
});
