import { describe, expect, it } from 'vitest';
import { createRulesRoutePlanner } from './rules-route-planner.js';

function context(status = 'grounded_with_demo') {
    return {
        sessionId: 'session', contractId: 'contract', routeRevision: 2, planningGeneration: 3,
        reason: 'customer_question', activeQuestion: { id: 'q:pdf', text: 'PDF var mı?' },
        knowledge: {
            intentId: 'q:pdf', query: 'PDF var mı?', status,
            evidence: status.startsWith('grounded') ? [{ evidenceId: 'e1' }] : [],
            demoTargets: status === 'grounded_with_demo'
                ? [{ pageUrl: 'https://example.test/import', heading: 'Ekstre Yükle' }]
                : [],
            knowledgeGap: { status: status === 'not_found' ? 'candidate' : 'none', reason: null }
        },
        currentRoute: [
            { id: 'old', type: 'answer', objective: 'Eski adım', requirement: 'preferred' },
            { id: 'close', type: 'obligation', objective: 'Kapanış', requirement: 'required_before_close' }
        ],
        obligations: {
            close: { requirement: 'required_before_close', status: 'pending' }
        },
        completedNodeIds: [], evidenceIds: ['e1'],
        allowedDemoTargets: status === 'grounded_with_demo'
            ? [{ pageUrl: 'https://example.test/import', heading: 'Ekstre Yükle' }]
            : []
    };
}

describe('rules route planner', () => {
    it('builds answer, demo and check nodes while preserving closing', async () => {
        const proposal = await createRulesRoutePlanner().propose(context());
        expect(proposal.proposedNodes.map((node) => node.type))
            .toEqual(['answer', 'demo', 'check', 'obligation']);
        expect(proposal.preserveObligationIds).toEqual(['close']);
        expect(proposal.proposedNodes[1].pageIntent.preferredUrl)
            .toBe('https://example.test/import');
        expect(proposal.proposedNodes[1].actions).toEqual([
            { intent: 'focus', target: 'Ekstre Yükle', safety: 'safe' }
        ]);
        expect(proposal.proposedNodes.slice(0, 3).map((node) => node.semanticIdentity.topicId))
            .toEqual([
                'topic:knowledge:q:pdf',
                'topic:knowledge:q:pdf',
                'topic:knowledge:q:pdf'
            ]);
        expect(proposal.proposedNodes[0].semanticIdentity.claimIds)
            .toEqual(['claim:evidence:e1']);
    });

    it('does not invent an answer when knowledge is not found', async () => {
        const proposal = await createRulesRoutePlanner().propose(context('not_found'));
        expect(proposal.proposedNodes.map((node) => node.type)).toEqual(['ask', 'obligation']);
    });
});
