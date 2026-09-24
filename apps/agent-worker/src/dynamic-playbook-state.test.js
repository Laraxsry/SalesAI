import { describe, expect, it } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import {
    canCompleteDynamicPlaybook,
    createDynamicPlaybookState,
    reduceDynamicPlaybookState
} from './dynamic-playbook-state.js';

function contract() {
    return compileLegacyPlaybook([
        {
            id: 'intro', order: 1, type: 'narrative', directive: 'Şirketi tanıt',
            url: null, actions: [], mode: 'situational', survey: null
        },
        {
            id: 'close', order: 2, type: 'narrative', directive: 'İletişim ve uygunluk iste',
            url: null, actions: [], mode: 'important', survey: null
        }
    ], {
        contractId: 'contract:agent-1',
        sourceVersion: 4,
        requiredBeforeCloseNodeIds: ['close']
    });
}

describe('dynamic playbook state', () => {
    it('creates session state without mutating the contract', () => {
        const compiled = contract();
        const state = createDynamicPlaybookState({ sessionId: 'session-1', contract: compiled });

        expect(state.routeRevision).toBe(0);
        expect(state.route).toEqual(compiled.nodes);
        expect(state.obligations.close).toEqual({
            requirement: 'required_before_close',
            status: 'pending',
            attempts: 0,
            completionEvidence: []
        });
        expect(compiled.obligations[0]).not.toHaveProperty('status');
    });

    it('completes nodes idempotently', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const started = reduceDynamicPlaybookState(initial, { type: 'NODE_STARTED', nodeId: 'intro' });
        const completed = reduceDynamicPlaybookState(started, { type: 'NODE_COMPLETED', nodeId: 'intro' });
        const duplicate = reduceDynamicPlaybookState(completed, { type: 'NODE_COMPLETED', nodeId: 'intro' });

        expect(completed.activeNodeId).toBeNull();
        expect(duplicate.completedNodeIds).toEqual(['intro']);
    });

    it('clears a deferred node without completing or skipping it', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const started = reduceDynamicPlaybookState(initial, { type: 'NODE_STARTED', nodeId: 'intro' });
        const deferred = reduceDynamicPlaybookState(started, { type: 'NODE_DEFERRED', nodeId: 'intro' });

        expect(deferred.activeNodeId).toBeNull();
        expect(deferred.completedNodeIds).toEqual([]);
        expect(deferred.skippedNodeIds).toEqual([]);
    });

    it('rejects a stale route revision and preserves the current route', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const planning = reduceDynamicPlaybookState(initial, { type: 'PLANNING_STARTED', reason: 'test' });
        const next = reduceDynamicPlaybookState(planning, {
            type: 'ROUTE_REVISION_ACCEPTED',
            planningGeneration: 1,
            baseRevision: 99,
            reason: 'late_planner_result',
            nodes: [{ id: 'new', type: 'answer', objective: 'Yeni yanıt' }]
        });

        expect(next.routeRevision).toBe(0);
        expect(next.route).toEqual(initial.route);
        expect(next.planning).toMatchObject({
            status: 'rejected',
            lastRejection: 'stale_base_revision'
        });
    });

    it('rejects an invalid current route revision without throwing', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const planning = reduceDynamicPlaybookState(initial, { type: 'PLANNING_STARTED', reason: 'test' });
        const next = reduceDynamicPlaybookState(planning, {
            type: 'ROUTE_REVISION_ACCEPTED',
            planningGeneration: 1,
            baseRevision: 0,
            reason: 'invalid_planner_output',
            nodes: [{ id: 'broken', type: 'unknown', objective: 'Geçersiz' }]
        });

        expect(next.route).toEqual(initial.route);
        expect(next.routeRevision).toBe(0);
        expect(next.planning).toMatchObject({
            status: 'rejected',
            lastRejection: 'invalid_route_revision'
        });
    });

    it('accepts a current route revision without losing obligations or history', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const completed = reduceDynamicPlaybookState(initial, { type: 'NODE_COMPLETED', nodeId: 'intro' });
        const planning = reduceDynamicPlaybookState(completed, { type: 'PLANNING_STARTED', reason: 'test' });
        const next = reduceDynamicPlaybookState(planning, {
            type: 'ROUTE_REVISION_ACCEPTED',
            planningGeneration: 1,
            baseRevision: 0,
            reason: 'customer_asked_about_pdf_import',
            nodes: [
                { id: 'answer_pdf', type: 'answer', objective: 'PDF sorusunu yanıtla' },
                completed.route.find((node) => node.id === 'close')
            ]
        });

        expect(next.routeRevision).toBe(1);
        expect(next.completedNodeIds).toEqual(['intro']);
        expect(next.memory.coveredTopics['topic:legacy:intro']).toHaveLength(1);
        expect(next.obligations.close.status).toBe('pending');
        expect(next.route.map((node) => node.id)).toEqual(['answer_pdf', 'close']);
        expect(next.activity).toBe('listening');
    });

    it('ignores a result from an older planning generation', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const first = reduceDynamicPlaybookState(initial, { type: 'PLANNING_STARTED', reason: 'first' });
        const second = reduceDynamicPlaybookState(first, { type: 'PLANNING_STARTED', reason: 'second' });
        const late = reduceDynamicPlaybookState(second, {
            type: 'ROUTE_REVISION_ACCEPTED',
            planningGeneration: 1,
            baseRevision: 0,
            reason: 'first',
            nodes: [{ id: 'late', type: 'check', objective: 'Eski sonuç' }]
        });

        expect(late).toBe(second);
    });

    it('requires open questions and closing obligations to reach terminal states', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const withQuestion = reduceDynamicPlaybookState(initial, {
            type: 'QUESTION_OPENED',
            questionId: 'question-1'
        });
        expect(canCompleteDynamicPlaybook(withQuestion)).toBe(false);

        const answered = reduceDynamicPlaybookState(withQuestion, {
            type: 'QUESTION_RESOLVED',
            questionId: 'question-1'
        });
        const active = reduceDynamicPlaybookState(answered, {
            type: 'OBLIGATION_STATUS_CHANGED',
            obligationId: 'close',
            status: 'active'
        });
        const declined = reduceDynamicPlaybookState(active, {
            type: 'OBLIGATION_STATUS_CHANGED',
            obligationId: 'close',
            status: 'declined',
            evidence: 'customer_declined_contact'
        });

        expect(declined.obligations.close).toMatchObject({
            status: 'declined',
            attempts: 1,
            completionEvidence: ['customer_declined_contact']
        });
        expect(canCompleteDynamicPlaybook(declined)).toBe(true);

        const completed = reduceDynamicPlaybookState(declined, { type: 'SESSION_COMPLETED' });
        expect(completed.conversationPhase).toBe('complete');
    });

    it('does not allow terminal obligations to be reopened', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const satisfied = reduceDynamicPlaybookState(initial, {
            type: 'OBLIGATION_STATUS_CHANGED',
            obligationId: 'close',
            status: 'satisfied',
            evidence: 'contact_requested'
        });
        const reopened = reduceDynamicPlaybookState(satisfied, {
            type: 'OBLIGATION_STATUS_CHANGED',
            obligationId: 'close',
            status: 'active'
        });

        expect(reopened).toBe(satisfied);
    });

    it('does not accept terminal obligation state without evidence', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const next = reduceDynamicPlaybookState(initial, {
            type: 'OBLIGATION_STATUS_CHANGED',
            obligationId: 'close',
            status: 'satisfied'
        });

        expect(next).toBe(initial);
        expect(next.obligations.close.status).toBe('pending');
    });

    it('ignores invalid phase and activity values', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const invalidPhase = reduceDynamicPlaybookState(initial, {
            type: 'PHASE_CHANGED',
            phase: 'teleporting'
        });
        const invalidActivity = reduceDynamicPlaybookState(initial, {
            type: 'ACTIVITY_CHANGED',
            activity: 'guessing'
        });

        expect(invalidPhase).toBe(initial);
        expect(invalidActivity).toBe(initial);
    });

    it('keeps approved adaptive surveys closed until an explicit reducer event opens them', () => {
        const initial = createDynamicPlaybookState({ sessionId: 'session-1', contract: contract() });
        const proposal = {
            proposalId: 'industry-1', baseRevision: 0, epoch: 0,
            purpose: 'demo_routing', questionKey: 'company.industry',
            question: 'Sektörünüz nedir?', reason: 'Demo rotasını belirler.',
            answerType: 'single_select',
            options: [{ value: 'finance', label: 'Finans' }, { value: 'saas', label: 'SaaS' }],
            requiredFor: ['demo_route'], blocking: false, confidenceThatUnknown: 0.9
        };
        const reviewed = reduceDynamicPlaybookState(initial, {
            type: 'SURVEY_PROPOSAL_REVIEWED', proposal,
            decision: { status: 'approved', reason: 'policy_passed', channel: 'survey' }
        });
        expect(reviewed.adaptiveSurvey.activeSurveyId).toBeNull();
        expect(reviewed.adaptiveSurvey.approvedProposal.proposalId).toBe('industry-1');

        const opened = reduceDynamicPlaybookState(reviewed, {
            type: 'ADAPTIVE_SURVEY_OPENED', proposalId: 'industry-1'
        });
        expect(opened.adaptiveSurvey).toMatchObject({
            activeSurveyId: 'industry-1', shownCount: 1, lastOpenedTurn: 0
        });
        const closed = reduceDynamicPlaybookState(opened, {
            type: 'ADAPTIVE_SURVEY_CLOSED', proposalId: 'industry-1'
        });
        expect(closed.adaptiveSurvey.activeSurveyId).toBeNull();
    });
});
