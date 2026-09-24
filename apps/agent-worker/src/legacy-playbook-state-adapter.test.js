import { describe, expect, it } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createLegacyPlaybookStateAdapter } from './legacy-playbook-state-adapter.js';

function setup() {
    const legacyNode = {
        id: 'close',
        order: 1,
        type: 'narrative',
        directive: 'İletişim ve uygunluk iste',
        url: null,
        actions: [],
        mode: 'important',
        survey: null
    };
    const contract = compileLegacyPlaybook([legacyNode], {
        contractId: 'contract:1',
        requiredBeforeCloseNodeIds: ['close']
    });
    const store = createDynamicPlaybookStore({ sessionId: 'session-1', contract });
    return { legacyNode, store, adapter: createLegacyPlaybookStateAdapter(store) };
}

describe('createLegacyPlaybookStateAdapter', () => {
    it('translates enter and exit into node and obligation evidence', () => {
        const { legacyNode, adapter } = setup();
        adapter.onNodeEvent(legacyNode, 'enter');
        adapter.onNodeEvent(legacyNode, 'exit', { reason: 'advance_step', empty: false });

        expect(adapter.snapshot()).toMatchObject({
            activeNodeId: null,
            completedNodeIds: ['close'],
            obligations: {
                close: {
                    status: 'satisfied',
                    attempts: 1,
                    completionEvidence: ['legacy_runtime_exit:advance_step']
                }
            }
        });
    });

    it('does not count a redelivery as a second obligation attempt', () => {
        const { legacyNode, adapter } = setup();
        adapter.onNodeEvent(legacyNode, 'enter');
        adapter.onNodeEvent(legacyNode, 'redeliver');

        expect(adapter.snapshot().obligations.close.attempts).toBe(1);
    });

    it('records empty exhausted content honestly instead of satisfying it', () => {
        const { legacyNode, adapter } = setup();
        adapter.onNodeEvent(legacyNode, 'enter');
        adapter.onNodeEvent(legacyNode, 'exit', { reason: 'silence', empty: true });

        expect(adapter.snapshot().obligations.close).toMatchObject({
            status: 'impossible',
            completionEvidence: ['legacy_node_exhausted_without_content']
        });
    });

    it('blocks completion until required obligations are terminal', () => {
        const { legacyNode, adapter } = setup();
        expect(adapter.onCompleted()).toMatchObject({
            accepted: false,
            reason: 'completion_guard_blocked'
        });

        adapter.onNodeEvent(legacyNode, 'enter');
        adapter.onNodeEvent(legacyNode, 'exit', { reason: 'advance_step', empty: false });
        expect(adapter.onCompleted()).toMatchObject({ accepted: true, reason: null });
        expect(adapter.snapshot().conversationPhase).toBe('complete');
    });
});
