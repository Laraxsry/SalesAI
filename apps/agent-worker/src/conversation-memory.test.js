import { describe, expect, it } from 'vitest';
import { ConversationMemoryInput } from '@repo/contracts';
import { projectPlanningMemory, reduceConversationMemory } from './conversation-memory.js';

function memory() {
    return ConversationMemoryInput.parse({});
}

function demoNode(overrides = {}) {
    return {
        id: 'reporting-demo',
        type: 'demo',
        deliveryIntent: 'proactive_promotion',
        evidenceRefs: ['knowledge:reporting'],
        semanticIdentity: {
            topicId: 'topic:reporting',
            claimIds: ['claim:reporting:auto'],
            source: 'semantic_resolver'
        },
        ...overrides
    };
}

describe('conversation memory', () => {
    it('records completed semantic nodes idempotently and survives route revisions', () => {
        const initial = reduceConversationMemory(memory(), { type: 'MEMORY_TURN_ADVANCED' });
        const completed = reduceConversationMemory(initial, {
            type: 'NODE_COMPLETED', nodeId: 'reporting-demo'
        }, { route: [demoNode()], routeRevision: 2 });
        const duplicate = reduceConversationMemory(completed, {
            type: 'NODE_COMPLETED', nodeId: 'reporting-demo'
        }, { route: [demoNode()], routeRevision: 2 });
        const unrelatedRevision = reduceConversationMemory(duplicate, {
            type: 'ROUTE_REVISION_ACCEPTED'
        }, { route: [], routeRevision: 3 });

        expect(unrelatedRevision.coveredTopics['topic:reporting']).toHaveLength(1);
        expect(unrelatedRevision.coveredTopics['topic:reporting'][0]).toMatchObject({
            status: 'demonstrated',
            turnIndex: 1,
            routeRevision: 2,
            proactiveMentionCount: 1,
            proactiveDemoCount: 1
        });
    });

    it('does not spend promotion budget for a customer-requested answer', () => {
        const next = reduceConversationMemory(memory(), {
            type: 'NODE_COMPLETED', nodeId: 'answer'
        }, {
            route: [demoNode({
                id: 'answer', type: 'answer', deliveryIntent: 'direct_answer'
            })],
            routeRevision: 1
        });
        const record = next.coveredTopics['topic:reporting'][0];
        expect(record).toMatchObject({
            status: 'explained',
            deliveryIntent: 'direct_answer',
            proactiveMentionCount: 0,
            proactiveDemoCount: 0
        });
    });

    it('keeps higher-confidence facts and remembers declined questions', () => {
        const discovered = reduceConversationMemory(memory(), {
            type: 'FACT_DISCOVERED',
            fact: { key: 'company.industry', value: 'saas', source: 'survey', confidence: 0.95 }
        });
        const weaker = reduceConversationMemory(discovered, {
            type: 'FACT_DISCOVERED',
            fact: { key: 'company.industry', value: 'finance', source: 'conversation', confidence: 0.6 }
        });
        const declined = reduceConversationMemory(weaker, {
            type: 'QUESTION_RECORDED',
            question: { questionKey: 'company.size', channel: 'survey', status: 'dismissed' }
        });
        const repeated = reduceConversationMemory(declined, {
            type: 'QUESTION_RECORDED',
            question: { questionKey: 'company.size', channel: 'voice', status: 'asked' }
        });

        expect(repeated.discoveredFacts['company.industry'].value).toBe('saas');
        expect(repeated.askedQuestions['company.size'].status).toBe('dismissed');
    });

    it('projects compact highest coverage without transcript text', () => {
        let state = memory();
        for (const [status, turnIndex] of [['mentioned', 1], ['explained', 2], ['confirmed', 3]]) {
            state = reduceConversationMemory(state, {
                type: 'COVERAGE_RECORDED',
                record: {
                    topicId: 'topic:reporting', claimId: 'claim:reporting:auto', status,
                    deliveryIntent: 'direct_answer', nodeId: `node-${status}`,
                    routeRevision: 1, turnIndex, proactiveMentionCount: 0,
                    proactiveDemoCount: 0, evidenceIds: []
                }
            });
        }
        const view = projectPlanningMemory(state);

        expect(view.coveredClaims).toEqual([expect.objectContaining({
            topicId: 'topic:reporting',
            claimId: 'claim:reporting:auto',
            highestStatus: 'confirmed',
            lastTurnIndex: 3
        })]);
        expect(JSON.stringify(view)).not.toContain('transcript');
    });
});
