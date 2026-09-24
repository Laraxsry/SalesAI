import { describe, expect, it } from 'vitest';
import { evaluateMultiAgentRun } from './multi-agent-eval.js';

describe('multi-agent replay eval', () => {
    it('summarizes accepted, stale and failed specialist runs', () => {
        expect(evaluateMultiAgentRun([
            { analystId: 'memory', status: 'accepted' },
            { analystId: 'memory', status: 'rejected', reason: 'stale_turn' },
            { analystId: 'follow_up', status: 'timeout' }
        ])).toMatchObject({
            total: 3, accepted: 1, failed: 1, stale: 1,
            acceptanceRate: 1 / 3, failureRate: 1 / 3
        });
    });
});
