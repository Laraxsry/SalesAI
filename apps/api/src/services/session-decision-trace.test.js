import { describe, expect, it } from 'vitest';
import { projectSessionDecisionTrace } from './session-decision-trace.js';

function event(seq, type, meta = {}, extra = {}) {
    return { seq, type, meta, at: new Date(`2026-09-23T10:00:0${seq}.000Z`), ...extra };
}

describe('projectSessionDecisionTrace', () => {
    it('projects revisions, node outcomes, reviewers and analysts', () => {
        const trace = projectSessionDecisionTrace([
            event(1, 'playbook.loaded', { active: true, nodes: [
                { id: 'intro', order: 1, directive: 'Ürünü tanıt', mode: 'important' },
                { id: 'close', order: 2, directive: 'Görüşme planla', mode: 'important' }
            ] }),
            event(2, 'playbook.dynamic_state.rollout_decision', {
                cohort: 'canary', configuredMode: 'canary', routeExecutionEnabled: true
            }),
            event(3, 'playbook.route_reviewed', { middlewareId: 'grounding', status: 'passed' }),
            event(4, 'playbook.route_proposal.accepted', {
                baseRevision: 0, resultingRevision: 1, reason: 'question',
                proposedNodes: [{ id: 'answer', type: 'answer', objective: 'Soruyu yanıtla', evidenceRefs: ['e1'] },
                    { id: 'close', type: 'obligation', objective: 'Görüşme planla', requirement: 'required_before_close' }]
            }, { durationMs: 42 }),
            event(5, 'playbook.node.enter', { nodeId: 'answer', directive: 'Soruyu yanıtla' }),
            event(6, 'playbook.node.exit', { nodeId: 'answer' }),
            event(7, 'multi_agent.analyst.result', { analystId: 'participant_memory', status: 'accepted', proposalType: 'memory_patch' })
        ]);

        expect(trace.cohort).toBe('canary');
        expect(trace.activeRevision).toBe(1);
        expect(trace.revisions).toHaveLength(2);
        expect(trace.revisions[1].nodes[0]).toMatchObject({ id: 'answer', status: 'completed', evidenceCount: 1 });
        expect(trace.revisions[1].reviews[0]).toMatchObject({ reviewerId: 'grounding', status: 'passed' });
        expect(trace.revisions[1].reviews.at(-1)).toMatchObject({ reviewerId: 'validator', status: 'accepted' });
        expect(trace.analysts[0]).toMatchObject({ analystId: 'participant_memory', status: 'accepted' });
    });

    it('never projects raw transcript, tool args, evidence text or URL query strings', () => {
        const trace = projectSessionDecisionTrace([
            event(1, 'playbook.loaded', { active: true, nodes: [{
                id: 'demo', directive: 'Göster', url: 'https://example.test/demo?token=secret',
                actions: [{ value: 'private@example.com' }]
            }] }),
            event(2, 'speech.transcript.user', { text: 'email private@example.com' }),
            event(3, 'tool.begin', { tool: 'browser_fill', args: { value: 'secret' } }),
            event(4, 'knowledge.resolved', { evidence: [{ text: 'private source text' }] })
        ]);
        const serialized = JSON.stringify(trace);

        expect(serialized).not.toContain('private@example.com');
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('private source text');
        expect(trace.revisions[0].nodes[0].page).toBe('https://example.test/demo');
    });

    it('keeps shadow revisions visible without marking them active', () => {
        const trace = projectSessionDecisionTrace([
            event(1, 'playbook.loaded', { active: true, nodes: [{ id: 'base', directive: 'Başlangıç' }] }),
            event(2, 'playbook.dynamic_state.rollout_decision', { cohort: 'shadow', configuredMode: 'shadow' }),
            event(3, 'playbook.route_proposal.accepted', {
                baseRevision: 0, resultingRevision: 1, reason: 'question', proposedNodeIds: ['answer']
            })
        ]);

        expect(trace.activeRevision).toBe(0);
        expect(trace.revisions[1].status).toBe('proposed_shadow');
    });
});
