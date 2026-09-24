import { describe, expect, it } from 'vitest';
import { createConversationEventBus } from './conversation-event-bus.js';
import { createAnalystRegistry } from './analyst-registry.js';
import { createBoundedContextProjector } from './context-projector.js';
import { createAnalystProposalValidator } from './proposal-validator.js';
import { createModelRouter } from './model-router.js';

function transcriptEvent(overrides = {}) {
    return {
        eventId: 'event-1',
        type: 'final_transcript',
        sessionId: 'session-1',
        participantId: 'participant-1',
        turnIndex: 2,
        routeRevision: 1,
        occurredAt: '2026-09-22T12:00:00.000Z',
        payload: { text: 'Güvenlik özelliklerini merak ediyorum.' },
        ...overrides
    };
}

function analyst(overrides = {}) {
    return {
        id: 'memory',
        version: '1.0.0',
        contextNeeds: [],
        supports: () => true,
        analyze: async () => null,
        ...overrides
    };
}

function memory() {
    return {
        revision: 4,
        turnIndex: 2,
        shared: {
            coveredTopics: ['raporlama'],
            openQuestions: [],
            companyFacts: [],
            currentRouteRevision: 1
        },
        participants: {
            'participant-1': {
                interests: ['güvenlik'],
                confirmedContact: { email: 'ali@example.com' },
                consent: { followUp: true }
            },
            'participant-2': {
                interests: ['fiyat'],
                confirmedContact: { email: 'ayse@example.com' }
            }
        }
    };
}

describe('conversation event bus', () => {
    it('delivers an immutable typed event and isolates subscriber errors', async () => {
        const errors = [];
        const received = [];
        const bus = createConversationEventBus({ onSubscriberError: (error) => errors.push(error) });
        bus.subscribe((event) => {
            received.push(event);
            expect(Object.isFrozen(event)).toBe(true);
            expect(Object.isFrozen(event.payload)).toBe(true);
        });
        bus.subscribe(() => { throw new Error('subscriber failed'); });

        const settled = await bus.publish(transcriptEvent());

        expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
        expect(received).toHaveLength(1);
        expect(errors).toHaveLength(1);
    });
});

describe('analyst registry and bounded context', () => {
    it('selects only supporting analysts and rejects duplicate ids', () => {
        const matching = analyst();
        const ignored = analyst({ id: 'follow_up', supports: () => false });
        const registry = createAnalystRegistry([matching, ignored]);

        expect(registry.matching(transcriptEvent())).toEqual([matching]);
        expect(() => registry.register(analyst())).toThrow(/duplicate/);
    });

    it('projects only the active participant and excludes contact and consent', () => {
        const projector = createBoundedContextProjector();
        const context = projector.project({
            analyst: analyst({ contextNeeds: ['participant_memory', 'shared_memory'] }),
            event: transcriptEvent(),
            executionContext: { memory: memory(), routeRevision: 1 }
        });
        const serialized = JSON.stringify(context);

        expect(context.participantMemory.interests).toEqual(['güvenlik']);
        expect(context.sharedMemory.coveredTopics).toEqual(['raporlama']);
        expect(serialized).not.toContain('ali@example.com');
        expect(serialized).not.toContain('ayse@example.com');
        expect(serialized).not.toContain('fiyat');
        expect(serialized).not.toContain('consent');
        expect(Object.isFrozen(context.participantMemory)).toBe(true);
    });
});

describe('proposal validation and model routing', () => {
    function proposal(overrides = {}) {
        return {
            proposalId: 'proposal-1',
            analystId: 'memory',
            analystVersion: '1.0.0',
            sessionId: 'session-1',
            participantId: 'participant-1',
            sourceEventIds: ['event-1'],
            baseMemoryRevision: 4,
            baseRouteRevision: 1,
            turnIndex: 2,
            confidence: 0.9,
            idempotencyKey: 'memory:event-1',
            expiresAt: '2026-09-22T12:01:00.000Z',
            proposalType: 'participant_memory',
            payload: { interests: ['güvenlik'] },
            ...overrides
        };
    }

    it('accepts once and rejects duplicates or stale revisions', () => {
        const validator = createAnalystProposalValidator({
            now: () => Date.parse('2026-09-22T12:00:30.000Z')
        });
        const args = {
            proposal: proposal(),
            event: transcriptEvent(),
            currentContext: { memoryRevision: 4, routeRevision: 1, turnIndex: 2 }
        };

        expect(validator.validateAndReserve(args).accepted).toBe(true);
        expect(validator.validateAndReserve(args)).toMatchObject({
            accepted: false, errors: [{ code: 'duplicate' }]
        });
        expect(createAnalystProposalValidator({
            now: () => Date.parse('2026-09-22T12:00:30.000Z')
        }).validateAndReserve({
            ...args,
            proposal: proposal({ baseMemoryRevision: 3 })
        })).toMatchObject({ accepted: false, errors: [{ code: 'stale_memory_revision' }] });
    });

    it('routes specialists independently with a validated default', () => {
        const router = createModelRouter({
            defaultRoute: {
                provider: 'openai', model: 'fast-model', timeoutMs: 500,
                maxOutputTokens: 300, concurrencyClass: 'turn_background'
            },
            routes: {
                route_critic: {
                    provider: 'openai', model: 'reasoning-model', timeoutMs: 1200,
                    maxOutputTokens: 700, concurrencyClass: 'turn_background'
                }
            }
        });

        expect(router.resolve('memory').model).toBe('fast-model');
        expect(router.resolve('route_critic').model).toBe('reasoning-model');
        expect(() => router.resolve('memory').model = 'mutated').toThrow();
    });
});
