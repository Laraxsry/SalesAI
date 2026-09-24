import { describe, expect, it, vi } from 'vitest';
import { RouteProposalInput } from '@repo/contracts';
import { createFollowUpClassificationAnalyst } from './follow-up-classification-analyst.js';
import { createParticipantMemoryAnalyst } from './participant-memory-analyst.js';
import { mapParticipantMemoryProposalToEvents } from './participant-memory-proposal-mapper.js';
import { createAnalystProposalFactory } from './proposal-factory.js';
import { createRouteCriticAnalystAdapter } from './route-critic-analyst-adapter.js';
import { createParticipantScopedMemory } from '../participant-memory/memory-state.js';
import { reduceParticipantScopedMemory } from '../participant-memory/memory-reducer.js';

const proposalFactory = createAnalystProposalFactory({
    createId: () => 'proposal-1',
    now: () => Date.parse('2026-09-22T12:00:00.000Z')
});

function context(type, payload, overrides = {}) {
    return {
        event: {
            eventId: 'event-1', type, sessionId: 'session-1',
            participantId: 'participant-1', turnIndex: 1, routeRevision: 0,
            occurredAt: '2026-09-22T12:00:00.000Z', payload
        },
        memoryRevision: 0,
        routeRevision: 0,
        turnIndex: 1,
        modelRoute: { provider: 'test', model: 'mini', timeoutMs: 500, maxOutputTokens: 100 },
        ...overrides
    };
}

describe('specialist analysts', () => {
    it('turns participant-scoped model analysis into a typed proposal', async () => {
        const invoke = vi.fn().mockResolvedValue({
            confidence: 0.91,
            interests: ['güvenlik'],
            objections: ['kurulum süresi']
        });
        const analyst = createParticipantMemoryAnalyst({ invoke, proposalFactory });

        const result = await analyst.analyze(context(
            'final_transcript',
            { text: 'Güvenlik önemli ama kurulum ne kadar sürer?' },
            { participantMemory: null, sharedMemory: {} }
        ), { signal: new AbortController().signal });

        expect(result).toMatchObject({
            proposalType: 'participant_memory',
            participantId: 'participant-1',
            payload: { interests: ['güvenlik'], objections: ['kurulum süresi'] }
        });
        expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
            transcript: 'Güvenlik önemli ama kurulum ne kadar sürer?'
        }));

        const acceptedEvents = mapParticipantMemoryProposalToEvents(result);
        const memory = acceptedEvents.reduce(
            reduceParticipantScopedMemory,
            createParticipantScopedMemory()
        );
        expect(memory.participants['participant-1']).toMatchObject({
            interests: ['güvenlik'], objections: ['kurulum süresi']
        });
    });

    it('classifies each company question without sending it anywhere', async () => {
        const analyst = createFollowUpClassificationAnalyst({
            proposalFactory,
            invoke: async () => ({
                confidence: 0.85,
                category: 'data_residency',
                department: 'security',
                priority: 'high'
            })
        });

        const result = await analyst.analyze(context('company_question', {
            question: 'Veriler hangi ülkede tutuluyor?', forwardingConsentEventId: 'consent-1'
        }), { signal: new AbortController().signal });

        expect(result).toMatchObject({
            proposalType: 'follow_up_classification',
            payload: { category: 'data_residency', department: 'security', priority: 'high' }
        });
    });

    it('adapts the existing route reviewer into a removal-only critique', async () => {
        const original = RouteProposalInput.parse({
            baseRevision: 0,
            planningGeneration: 1,
            reason: 'test',
            proposedNodes: [
                { id: 'answer', type: 'answer', objective: 'Soruyu yanıtla' },
                { id: 'demo', type: 'demo', objective: 'Aynı şeyi tekrar göster' }
            ]
        });
        const reviewer = {
            id: 'route_critic',
            review: async (proposal) => ({
                ...proposal,
                proposedNodes: proposal.proposedNodes.filter((node) => node.id !== 'demo')
            })
        };
        const analyst = createRouteCriticAnalystAdapter({ reviewer, proposalFactory });
        const result = await analyst.analyze(context('route_proposed', {
            proposalId: 'route-1', reason: 'test'
        }, {
            routeProposal: original,
            planningContext: { sessionId: 'session-1' }
        }), { signal: new AbortController().signal });

        expect(result).toMatchObject({
            proposalType: 'route_critique',
            payload: { removeNodeIds: ['demo'] }
        });
    });
});
