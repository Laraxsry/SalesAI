import { describe, expect, it } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createRoutePlanningService } from './route-planning-service.js';
import { createRulesRoutePlanner } from './rules-route-planner.js';
import { createModelRoutePlanner } from './model-route-planner.js';
import { createPlanMiddlewarePipeline } from './plan-middleware-pipeline.js';

function store() {
    const contract = compileLegacyPlaybook([{
        id: 'close', order: 1, type: 'narrative', directive: 'Kapanış yap',
        url: null, actions: [], mode: 'important', survey: null
    }], { contractId: 'contract', requiredBeforeCloseNodeIds: ['close'] });
    return createDynamicPlaybookStore({ sessionId: 'session', contract });
}

function resolution(intentId, query) {
    return {
        intentId, query, status: 'grounded',
        evidence: [{
            evidenceId: `evidence:${intentId}`, kind: 'knowledge', text: 'Doğrulanmış yanıt',
            score: 0.9, sourceId: 'source:1', page: null
        }],
        demoTargets: [], knowledgeGap: { status: 'none', reason: null }
    };
}

describe('route planning service', () => {
    it('accepts a validated rules proposal through the reducer', async () => {
        const stateStore = store();
        const service = createRoutePlanningService({
            store: stateStore,
            planner: createRulesRoutePlanner()
        });
        const knowledge = resolution('q1', 'Soru');
        const result = await service.replan({
            reason: 'question', activeQuestion: { id: 'q1', text: 'Soru' }, knowledge
        });

        expect(result.type).toBe('accepted');
        expect(stateStore.snapshot().routeRevision).toBe(1);
        expect(stateStore.snapshot().route.at(-1).id).toBe('close');
    });

    it('accepts an LLM-prioritized candidate route only through the validator', async () => {
        const stateStore = store();
        const service = createRoutePlanningService({
            store: stateStore,
            planner: createModelRoutePlanner({
                candidates: createRulesRoutePlanner(),
                complete: async ({ messages }) => {
                    const input = JSON.parse(messages[0].content);
                    return { text: JSON.stringify({
                        selectedNodeIds: input.candidates.filter((item) => item.type === 'answer')
                            .map((item) => item.id)
                    }) };
                }
            })
        });
        const result = await service.replan({
            reason: 'question', activeQuestion: { id: 'q1', text: 'Soru' },
            knowledge: resolution('q1', 'Soru')
        });
        expect(result.type).toBe('accepted');
        expect(stateStore.snapshot().route.map((node) => node.type))
            .toEqual(['answer', 'obligation']);
        expect(stateStore.snapshot().route[0].createdBy).toBe('planner');
    });

    it('does not let a late first plan overwrite a newer route', async () => {
        const stateStore = store();
        const resolvers = [];
        const planner = {
            propose: (context) => new Promise((resolve) => {
                resolvers.push(() => createRulesRoutePlanner().propose(context).then(resolve));
            })
        };
        const service = createRoutePlanningService({ store: stateStore, planner });
        const first = service.replan({
            reason: 'first', activeQuestion: { id: 'q1', text: 'İlk' },
            knowledge: resolution('q1', 'İlk')
        });
        const second = service.replan({
            reason: 'second', activeQuestion: { id: 'q2', text: 'İkinci' },
            knowledge: resolution('q2', 'İkinci')
        });

        await resolvers[1]();
        expect((await second).type).toBe('accepted');
        await resolvers[0]();
        expect((await first).type).toBe('rejected');
        expect(stateStore.snapshot().routeRevision).toBe(1);
        expect(stateStore.snapshot().route.some((node) => node.sourceQuestionId === 'q2')).toBe(true);
        expect(stateStore.snapshot().route.some((node) => node.sourceQuestionId === 'q1')).toBe(false);
    });

    it('keeps reviewer failures fail-open', async () => {
        const stateStore = store();
        const service = createRoutePlanningService({
            store: stateStore,
            planner: createRulesRoutePlanner(),
            reviewers: { review: () => { throw new Error('review pipeline offline'); } }
        });
        const result = await service.replan({
            reason: 'question', activeQuestion: { id: 'q1', text: 'Soru' },
            knowledge: resolution('q1', 'Soru')
        });

        expect(result.type).toBe('accepted');
        expect(result.reviews).toEqual([
            { middlewareId: null, status: 'skipped_pipeline_error' }
        ]);
    });

    it('reports deterministic end-to-end planning latency', async () => {
        const stateStore = store();
        let time = 100;
        const decisions = [];
        const service = createRoutePlanningService({
            store: stateStore,
            planner: {
                propose: async (context) => {
                    time = 175;
                    return createRulesRoutePlanner().propose(context);
                }
            },
            onDecision: (decision) => decisions.push(decision),
            now: () => time
        });
        const result = await service.replan({
            reason: 'question', activeQuestion: { id: 'q1', text: 'Soru' },
            knowledge: resolution('q1', 'Soru')
        });

        expect(result.durationMs).toBe(75);
        expect(decisions.map((decision) => [decision.type, decision.durationMs]))
            .toEqual([['started', 0], ['accepted', 75]]);
    });

    it('reverts an unsafe reviewer revision and validates the original safe proposal', async () => {
        const stateStore = store();
        const reviewers = createPlanMiddlewarePipeline({
            middlewares: [{
                id: 'unsafe_critic',
                review: (proposal) => ({
                    ...proposal,
                    proposedNodes: proposal.proposedNodes.map((node, index) => index === 0
                        ? {
                            ...node,
                            actions: [{ intent: 'click', target: 'Delete', safety: 'destructive' }]
                        }
                        : node)
                })
            }]
        });
        const service = createRoutePlanningService({
            store: stateStore,
            planner: createRulesRoutePlanner(),
            reviewers
        });
        const result = await service.replan({
            reason: 'question', activeQuestion: { id: 'q1', text: 'Soru' },
            knowledge: resolution('q1', 'Soru')
        });

        expect(result.type).toBe('accepted');
        expect(result.reviews.at(-1)).toEqual({
            middlewareId: null,
            status: 'reverted_by_policy'
        });
        expect(stateStore.snapshot().routeRevision).toBe(1);
        expect(stateStore.snapshot().route.flatMap((node) => node.actions))
            .not.toContainEqual(expect.objectContaining({ safety: 'destructive' }));
    });
});
