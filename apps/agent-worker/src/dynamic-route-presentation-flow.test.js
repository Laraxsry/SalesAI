import { describe, expect, it, vi } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createLegacyPlaybookStateAdapter } from './legacy-playbook-state-adapter.js';
import { createRoutePlanningService } from './route-planning-service.js';
import { createRulesRoutePlanner } from './rules-route-planner.js';
import { createPlaybookCursor } from './playbook-cursor.js';
import { createPlaybookRuntime } from './playbook-runtime.js';
import { projectDynamicRouteForPresentation } from './dynamic-route-presentation.js';

async function flush() {
    for (let index = 0; index < 12; index++) await Promise.resolve();
}

describe('accepted dynamic route presentation flow', () => {
    it('answers once, prepares a grounded demo, then reaches required closing', async () => {
        const contract = compileLegacyPlaybook([
            { id: 'old', order: 1, type: 'narrative', directive: 'Old topic',
                url: null, actions: [], mode: 'situational', survey: null },
            { id: 'close', order: 2, type: 'narrative', directive: 'Arrange a meeting',
                url: null, actions: [], mode: 'important', survey: null }
        ], { contractId: 'contract', requiredBeforeCloseNodeIds: ['close'] });
        const store = createDynamicPlaybookStore({ sessionId: 'session', contract });
        const adapter = createLegacyPlaybookStateAdapter(store);
        const events = [];
        const handles = [];
        const speak = vi.fn((instructions) => {
            events.push(`speak:${instructions}`);
            let finish;
            const handle = {
                chatItems: [], interrupted: false,
                waitForPlayout: () => new Promise((resolve) => { finish = resolve; }),
                finish: () => finish()
            };
            handles.push(handle);
            return handle;
        });
        const cursor = createPlaybookCursor([
            { id: 'old', order: 1, type: 'narrative', directive: 'Old topic',
                url: null, actions: [], mode: 'situational' },
            { id: 'close', order: 2, type: 'narrative', directive: 'Arrange a meeting',
                url: null, actions: [], mode: 'important' }
        ]);
        const runtime = createPlaybookRuntime({
            cursor, speak,
            screen: {
                showUrl: async (url) => { events.push(`navigate:${url}`); return { ok: true }; },
                hideScreen: async () => ({ ok: true })
            },
            prepareNode: async (step) => {
                events.push(`prepare:${step.id}`);
                return { ok: true };
            },
            onNodeEvent: (step, phase, meta) => adapter.onNodeEvent(step, phase, meta)
        });
        runtime.start();
        await flush();

        const service = createRoutePlanningService({ store, planner: createRulesRoutePlanner() });
        const question = { id: 'q1', text: 'Can you show the report?' };
        const decision = await service.replan({
            reason: 'customer_question', activeQuestion: question,
            knowledge: {
                intentId: 'q1', query: question.text, status: 'grounded_with_demo',
                evidence: [{ evidenceId: 'e1', kind: 'knowledge', text: 'Report exists',
                    score: 0.9, sourceId: 'source', page: null }],
                demoTargets: [{ pageUrl: 'https://example.test/report', heading: 'Report' }],
                knowledgeGap: { status: 'none', reason: null }
            },
            allowedDemoTargets: [{ pageUrl: 'https://example.test/report', heading: 'Report' }]
        });
        expect(decision.type).toBe('accepted');
        store.dispatch({ type: 'QUESTION_OPENED', questionId: 'q1' });
        runtime.reviseRoute(projectDynamicRouteForPresentation(decision.proposal.proposedNodes),
            { waitForAnswer: true });
        handles[0].finish();
        await flush();
        expect(speak).toHaveBeenCalledTimes(1);
        const answerId = decision.proposal.proposedNodes.find((step) => step.type === 'answer').id;
        expect(runtime.acknowledgeHeldNode(answerId)).toBe(true);
        store.dispatch({ type: 'NODE_COMPLETED', nodeId: answerId });
        store.dispatch({ type: 'QUESTION_RESOLVED', questionId: 'q1' });
        runtime.resumeRoute();
        await flush();
        expect(events.findIndex((event) => event.startsWith('navigate:')))
            .toBeLessThan(events.findIndex((event) => event.startsWith('prepare:')));
        const prepareIndex = events.findIndex((event) => event.startsWith('prepare:'));
        expect(events.findIndex((event, index) => index > prepareIndex
            && event.startsWith('speak:'))).toBeGreaterThan(prepareIndex);

        for (let index = 1; index <= 3; index++) {
            handles[index].chatItems.push({ type: 'message', role: 'assistant' });
            handles[index].finish();
            await flush();
            runtime.signal('advance_step');
            await flush();
        }
        expect(runtime.completed).toBe(true);
        expect(store.snapshot().obligations.close.status).toBe('satisfied');
        expect(store.snapshot().openQuestions).toEqual([]);
    });
});
