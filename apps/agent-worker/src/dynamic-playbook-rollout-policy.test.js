import { describe, expect, it } from 'vitest';
import {
    createDynamicPlaybookRolloutPolicy,
    stableRolloutBucket
} from './dynamic-playbook-rollout-policy.js';

describe('dynamic playbook rollout policy', () => {
    it('keeps the legacy runtime authoritative in every observation cohort', () => {
        for (const mode of ['off', 'shadow', 'canary']) {
            const decision = createDynamicPlaybookRolloutPolicy({
                mode, canaryPercent: 100
            }).decide({ sessionId: 'session', agentId: 'agent', productId: 'product' });
            expect(decision.runtimeAuthority).toBe('legacy');
            expect(decision.legacyRetirementAllowed).toBe(false);
        }
    });

    it('assigns the same session to the same canary bucket', () => {
        expect(stableRolloutBucket('session-42')).toBe(stableRolloutBucket('session-42'));
        const policy = createDynamicPlaybookRolloutPolicy({ mode: 'canary', canaryPercent: 47 });
        expect(policy.decide({ sessionId: 'session-42' }))
            .toEqual(policy.decide({ sessionId: 'session-42' }));
    });

    it('samples active sessions without environment ID targeting', () => {
        const policy = createDynamicPlaybookRolloutPolicy({
            mode: 'canary', canaryPercent: 100
        });
        expect(policy.decide({ sessionId: '1' }).cohort).toBe('canary');
        expect(policy.decide({ sessionId: '2' }).cohort).toBe('canary');
    });

    it('fails closed for unknown modes and invalid percentages', () => {
        const decision = createDynamicPlaybookRolloutPolicy({
            mode: 'live', canaryPercent: 'not-a-number'
        }).decide({ sessionId: 'session' });
        expect(decision).toMatchObject({ cohort: 'control', configuredMode: 'off' });
    });
});
