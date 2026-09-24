import { describe, expect, it } from 'vitest';
import { createAnalystRegistry } from './analyst-registry.js';
import { createAnalystRunner } from './analyst-runner.js';
import { createBoundedContextProjector } from './context-projector.js';
import { createOrchestrationTelemetry } from './orchestration-telemetry.js';
import { createAnalystProposalValidator } from './proposal-validator.js';

function event() {
    return {
        eventId: 'event-1', type: 'final_transcript', sessionId: 'session-1',
        participantId: 'participant-1', turnIndex: 1, routeRevision: 0,
        occurredAt: new Date(Date.now() - 1000).toISOString(),
        payload: { text: 'Güvenlik önemli.' }
    };
}

function proposal(analystId, overrides = {}) {
    return {
        proposalId: `proposal-${analystId}`,
        analystId,
        analystVersion: '1.0.0',
        sessionId: 'session-1',
        participantId: 'participant-1',
        sourceEventIds: ['event-1'],
        baseMemoryRevision: 0,
        baseRouteRevision: 0,
        turnIndex: 1,
        confidence: 0.9,
        idempotencyKey: `${analystId}:event-1`,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        proposalType: 'participant_memory',
        payload: { interests: ['güvenlik'] },
        ...overrides
    };
}

function runner(analysts, options = {}) {
    return createAnalystRunner({
        registry: createAnalystRegistry(analysts),
        contextProjector: createBoundedContextProjector(),
        proposalValidator: createAnalystProposalValidator(),
        ...options
    });
}

describe('analyst runner', () => {
    it('runs independent analysts in parallel within the concurrency bound', async () => {
        let active = 0;
        let maximum = 0;
        const analysts = ['one', 'two', 'three'].map((id) => ({
            id, version: '1.0.0', contextNeeds: [], supports: () => true,
            async analyze() {
                active += 1;
                maximum = Math.max(maximum, active);
                await new Promise((resolve) => setTimeout(resolve, 15));
                active -= 1;
                return proposal(id);
            }
        }));

        const results = await runner(analysts, { maxConcurrency: 2 }).run({
            event: event(), executionContext: { memory: {}, routeRevision: 0, turnIndex: 1 }
        });

        expect(maximum).toBe(2);
        expect(results.map((result) => result.status)).toEqual(['accepted', 'accepted', 'accepted']);
    });

    it('rejects a proposal that becomes stale while the analyst is working', async () => {
        const analyst = {
            id: 'memory', version: '1.0.0', contextNeeds: [], supports: () => true,
            analyze: async () => proposal('memory')
        };
        const results = await runner([analyst]).run({
            event: event(),
            executionContext: { memory: {}, routeRevision: 0, turnIndex: 1 },
            getCurrentContext: () => ({ memory: { revision: 1 }, routeRevision: 0, turnIndex: 1 })
        });

        expect(results[0]).toMatchObject({
            status: 'rejected', errors: [{ code: 'stale_memory_revision' }]
        });
    });

    it('times out one analyst without throwing or blocking other results', async () => {
        const slow = {
            id: 'slow', version: '1.0.0', timeoutMs: 20, contextNeeds: [], supports: () => true,
            analyze: () => new Promise(() => {})
        };
        const fast = {
            id: 'fast', version: '1.0.0', contextNeeds: [], supports: () => true,
            analyze: async () => proposal('fast')
        };
        const records = [];
        const results = await runner([slow, fast], {
            telemetry: createOrchestrationTelemetry({ onRecord: (record) => records.push(record) })
        }).run({
            event: event(), executionContext: { memory: {}, routeRevision: 0, turnIndex: 1 }
        });

        expect(results.map((result) => result.status)).toEqual(['timeout', 'accepted']);
        expect(records).toEqual(expect.arrayContaining([
            expect.objectContaining({ analystId: 'slow', status: 'timeout' }),
            expect.objectContaining({ analystId: 'fast', status: 'accepted' })
        ]));
        expect(JSON.stringify(records)).not.toContain('Güvenlik önemli');
    });

    it('cancels promptly through AbortSignal', async () => {
        const controller = new AbortController();
        const waiting = {
            id: 'waiting', version: '1.0.0', timeoutMs: 5000,
            contextNeeds: [], supports: () => true,
            analyze: () => new Promise(() => {})
        };
        const promise = runner([waiting]).run({
            event: event(), executionContext: { memory: {}, routeRevision: 0, turnIndex: 1 },
            signal: controller.signal
        });
        controller.abort();

        await expect(promise).resolves.toMatchObject([{ status: 'cancelled' }]);
    });
});
