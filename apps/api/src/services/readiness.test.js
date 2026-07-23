import { describe, it, expect } from 'vitest';
import { summarizeReadiness } from './readiness.js';

/**
 * summarizeReadiness is the only pure part of GET /ready — checkMongo/
 * checkRedis/checkLiveKit need a real dependency to test meaningfully, but
 * the "how do individual check results become the response" decision is
 * plain data transformation and worth pinning down on its own: this is
 * exactly what an orchestrator probe (Docker/Kubernetes/Traffic Manager)
 * reads to decide whether to route traffic here.
 */
describe('summarizeReadiness', () => {
    it('is ready when every check passes', () => {
        const result = summarizeReadiness([
            { name: 'mongodb', ok: true },
            { name: 'redis', ok: true },
            { name: 'livekit', ok: true }
        ]);
        expect(result).toEqual({
            ok: true,
            checks: {
                mongodb: { ok: true },
                redis: { ok: true },
                livekit: { ok: true }
            }
        });
    });

    it('is not ready when any single check fails', () => {
        const result = summarizeReadiness([
            { name: 'mongodb', ok: true },
            { name: 'redis', ok: false, error: 'connect ECONNREFUSED' },
            { name: 'livekit', ok: true }
        ]);
        expect(result.ok).toBe(false);
        expect(result.checks.redis).toEqual({ ok: false, error: 'connect ECONNREFUSED' });
    });

    it('is not ready when every check fails', () => {
        const result = summarizeReadiness([
            { name: 'mongodb', ok: false, error: 'not connected' },
            { name: 'redis', ok: false, error: 'timeout' }
        ]);
        expect(result.ok).toBe(false);
    });

    it('omits the error field for passing checks', () => {
        const result = summarizeReadiness([{ name: 'mongodb', ok: true }]);
        expect(result.checks.mongodb).not.toHaveProperty('error');
    });

    it('is vacuously ready for an empty check list', () => {
        expect(summarizeReadiness([])).toEqual({ ok: true, checks: {} });
    });
});
