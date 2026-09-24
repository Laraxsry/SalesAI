/**
 * Maps knowledge application events into the dynamic playbook ledger without
 * coupling the resolver to reducer event names or session-state structure.
 *
 * @param {{dispatch:(event:object)=>object, snapshot:()=>object}} store
 */
export function createKnowledgePlaybookStateAdapter(store) {
    return {
        onResolution(resolution) {
            for (const item of resolution?.evidence ?? []) {
                store.dispatch({
                    type: 'EVIDENCE_RECORDED',
                    evidenceId: item.evidenceId
                });
            }
        },

        onCapabilityRequest(requestId) {
            store.dispatch({
                type: 'CAPABILITY_REQUEST_RECORDED',
                requestId
            });
        },

        snapshot: () => store.snapshot()
    };
}
