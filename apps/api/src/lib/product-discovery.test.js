import { describe, expect, it } from 'vitest';
import {
    ProductDiscoveryInput, DiscoveryFieldDefinitionInput, SurveyPolicyInput
} from '@repo/contracts';
import { compileProductDiscovery, projectProductDiscovery } from './product-discovery.js';

describe('product discovery authoring', () => {
    it('compiles simple importance choices into bounded runtime definitions', () => {
        const stored = compileProductDiscovery({
            enabled: true,
            priorities: { industry: 'important', teamSize: 'helpful', primaryGoal: 'off' }
        });
        expect(stored).toEqual({
            enabled: true,
            policy: { enabled: true },
            fields: [
                { key: 'company.industry', importance: 'required',
                    affects: ['demo_route', 'pricing'], preferredInput: 'single_select' },
                { key: 'company.team_size', importance: 'recommended',
                    affects: ['qualification'], preferredInput: 'single_select' }
            ]
        });
        expect(SurveyPolicyInput.safeParse(stored.policy).success).toBe(true);
        expect(stored.fields.every((field) =>
            DiscoveryFieldDefinitionInput.safeParse(field).success)).toBe(true);
        expect(projectProductDiscovery(stored)).toEqual({
            enabled: true,
            priorities: { industry: 'important', teamSize: 'helpful', primaryGoal: 'off' }
        });
    });

    it('requires an enabled field and rejects arbitrary policy/field keys', () => {
        expect(ProductDiscoveryInput.safeParse({
            enabled: true, priorities: { industry: 'off', teamSize: 'off', primaryGoal: 'off' }
        }).success).toBe(false);
        expect(ProductDiscoveryInput.safeParse({
            enabled: true, priorities: { industry: 'important', secret: 'important' }
        }).success).toBe(false);
        expect(ProductDiscoveryInput.safeParse({
            enabled: true, priorities: { industry: 'important' }, policy: { maxPerSession: 100 }
        }).success).toBe(false);
    });

    it('projects products without configuration as disabled', () => {
        expect(projectProductDiscovery(null)).toEqual({
            enabled: false,
            priorities: { industry: 'off', teamSize: 'off', primaryGoal: 'off' }
        });
    });
});
