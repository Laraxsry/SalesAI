import { describe, expect, it } from 'vitest';
import { evaluateMultiAgentPilotReadiness } from './multi-agent-pilot-readiness.js';

describe('three-product multi-agent pilot readiness', () => {
    it('accepts the three planned product shapes with no leakage or latency regression', () => {
        const report = evaluateMultiAgentPilotReadiness({ sessions: [
            { productId: 'p-1', profile: 'short_pitch', cohort: 'shadow',
                memoryLeakageCount: 0, firstResponseLatencyMs: 800 },
            { productId: 'p-2', profile: 'browser_demo', cohort: 'canary',
                memoryLeakageCount: 0, firstResponseLatencyMs: 1100 },
            { productId: 'p-3', profile: 'objection_heavy', cohort: 'canary',
                memoryLeakageCount: 0, firstResponseLatencyMs: 1400 }
        ] });
        expect(report).toMatchObject({ readyForLivePilot: true, productCount: 3, blockers: [] });
    });

    it('blocks rollout on cross-participant leakage', () => {
        const report = evaluateMultiAgentPilotReadiness({ sessions: [
            { productId: 'p-1', profile: 'short_pitch', cohort: 'shadow', memoryLeakageCount: 1 },
            { productId: 'p-2', profile: 'browser_demo', cohort: 'canary', memoryLeakageCount: 0 },
            { productId: 'p-3', profile: 'objection_heavy', cohort: 'canary', memoryLeakageCount: 0 }
        ] });
        expect(report.readyForLivePilot).toBe(false);
        expect(report.blockers).toContain('participant_memory_leakage');
    });
});
