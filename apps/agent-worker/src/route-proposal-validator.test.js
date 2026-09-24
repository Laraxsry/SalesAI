import { describe, expect, it } from 'vitest';
import { validateRouteProposal } from './route-proposal-validator.js';

function fixture() {
    const closing = {
        id: 'close', type: 'obligation', objective: 'İletişim için izin ve uygunluk al',
        requirement: 'required_before_close', createdBy: 'initial_contract'
    };
    const evidence = {
        evidenceId: 'knowledge:pdf', kind: 'knowledge', text: 'PDF desteklenir',
        score: 0.9, sourceId: 'source:1',
        page: { url: 'https://example.test/import' }
    };
    const context = {
        sessionId: 'session', contractId: 'contract', routeRevision: 0,
        planningGeneration: 1, reason: 'question',
        activeQuestion: { id: 'q1', text: 'PDF var mı?' },
        knowledge: {
            intentId: 'q1', query: 'PDF var mı?', status: 'grounded_with_demo',
            evidence: [evidence],
            demoTargets: [{ pageUrl: 'https://example.test/import' }],
            knowledgeGap: { status: 'none', reason: null }
        },
        currentRoute: [{ id: 'intro', type: 'answer', objective: 'Tanıt' }, closing],
        obligations: {
            close: { requirement: 'required_before_close', status: 'pending', attempts: 0, completionEvidence: [] }
        },
        completedNodeIds: [], evidenceIds: ['knowledge:pdf'],
        allowedDemoTargets: [{ pageUrl: 'https://example.test/import' }], maxRouteNodes: 20
    };
    const proposal = {
        baseRevision: 0, planningGeneration: 1, reason: 'question',
        proposedNodes: [
            {
                id: 'answer', type: 'answer', objective: 'PDF sorusunu yanıtla',
                sourceQuestionId: 'q1', evidenceRefs: ['knowledge:pdf'], createdBy: 'planner'
            },
            closing
        ],
        preserveObligationIds: ['close'], obsoleteOptionalNodeIds: ['intro']
    };
    const state = { routeRevision: 0, planning: { generation: 1 } };
    return { context, proposal, state, closing };
}

describe('route proposal validator', () => {
    it('accepts a grounded proposal that preserves closing obligations', () => {
        const input = fixture();
        expect(validateRouteProposal(input)).toMatchObject({ accepted: true });
    });

    it('rejects dropping a pending required-before-close obligation', () => {
        const input = fixture();
        input.proposal.proposedNodes = input.proposal.proposedNodes.filter((node) => node.id !== 'close');
        input.proposal.preserveObligationIds = [];

        const result = validateRouteProposal(input);
        expect(result.accepted).toBe(false);
        expect(result.errors.map((error) => error.code)).toContain('required_obligation_missing_from_route');
    });

    it('rejects invented evidence, unapproved demos, and destructive actions', () => {
        const input = fixture();
        input.proposal.proposedNodes[0] = {
            id: 'unsafe', type: 'demo', objective: 'Uydurma demo', sourceQuestionId: 'q1',
            evidenceRefs: ['knowledge:invented'], createdBy: 'planner',
            pageIntent: { purpose: 'demo', preferredUrl: 'https://evil.test/path' },
            actions: [{ intent: 'click', target: 'Delete', safety: 'destructive' }]
        };

        const result = validateRouteProposal(input);
        const codes = result.errors.map((error) => error.code);
        expect(codes).toContain('unknown_evidence_reference');
        expect(codes).toContain('demo_target_not_allowed');
        expect(codes).toContain('destructive_action_rejected');
    });

    it('rejects a proposal from a superseded generation', () => {
        const input = fixture();
        input.state.planning.generation = 2;
        expect(validateRouteProposal(input).errors.map((error) => error.code))
            .toContain('stale_planning_generation');
    });
});
