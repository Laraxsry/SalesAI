import { canCompleteDynamicPlaybook } from './dynamic-playbook-state.js';

/**
 * Anti-corruption layer between the proven legacy cursor/runtime vocabulary
 * and the new dynamic domain events. It observes legacy callbacks without
 * teaching either runtime about the other's state representation.
 *
 * @param {{dispatch:(event:object)=>object, snapshot:()=>object}} store
 */
export function createLegacyPlaybookStateAdapter(store) {
    function obligationFor(nodeId) {
        return store.snapshot().obligations[nodeId] ?? null;
    }

    function finishObligation(node, meta = {}) {
        if (!obligationFor(node.id)) return;

        if (meta.skipped === true) {
            store.dispatch({
                type: 'OBLIGATION_STATUS_CHANGED',
                obligationId: node.id,
                status: 'declined',
                evidence: 'legacy_survey_skipped'
            });
            return;
        }

        if (meta.empty === true) {
            store.dispatch({
                type: 'OBLIGATION_STATUS_CHANGED',
                obligationId: node.id,
                status: 'impossible',
                evidence: 'legacy_node_exhausted_without_content'
            });
            return;
        }

        store.dispatch({
            type: 'OBLIGATION_STATUS_CHANGED',
            obligationId: node.id,
            status: 'satisfied',
            evidence: `legacy_runtime_exit:${meta.reason ?? 'completed'}`
        });
    }

    return {
        onNodeEvent(node, phase, meta = {}) {
            if (phase === 'enter') {
                store.dispatch({ type: 'NODE_STARTED', nodeId: node.id });
                if (obligationFor(node.id)) {
                    store.dispatch({
                        type: 'OBLIGATION_STATUS_CHANGED',
                        obligationId: node.id,
                        status: 'active'
                    });
                }
                return;
            }

            // A redelivery is the same logical attempt and must not increment
            // the obligation attempt counter a second time.
            if (phase === 'deferred') {
                store.dispatch({ type: 'NODE_DEFERRED', nodeId: node.id });
                return;
            }
            if (phase === 'exit') {
                if (meta.skipped === true) {
                    store.dispatch({ type: 'NODE_SKIPPED', nodeId: node.id });
                } else {
                    store.dispatch({ type: 'NODE_COMPLETED', nodeId: node.id });
                }
                finishObligation(node, meta);
            }
        },

        onCompleted() {
            const before = store.snapshot();
            if (!canCompleteDynamicPlaybook(before)) {
                return { accepted: false, state: before, reason: 'completion_guard_blocked' };
            }

            const state = store.dispatch({ type: 'SESSION_COMPLETED' });
            return {
                accepted: state.conversationPhase === 'complete',
                state,
                reason: state.conversationPhase === 'complete' ? null : 'completion_guard_blocked'
            };
        },

        snapshot: () => store.snapshot()
    };
}
