import { describe, expect, it } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';
import { createKnowledgePlaybookStateAdapter } from './knowledge-playbook-state-adapter.js';

function adapter() {
    const contract = compileLegacyPlaybook([], { contractId: 'contract:1' });
    const store = createDynamicPlaybookStore({ sessionId: 'session-1', contract });
    return createKnowledgePlaybookStateAdapter(store);
}

describe('createKnowledgePlaybookStateAdapter', () => {
    it('records evidence ids idempotently', () => {
        const stateAdapter = adapter();
        const resolution = {
            evidence: [
                { evidenceId: 'knowledge:c1' },
                { evidenceId: 'knowledge:c2' },
                { evidenceId: 'knowledge:c1' }
            ]
        };

        stateAdapter.onResolution(resolution);
        stateAdapter.onResolution(resolution);
        expect(stateAdapter.snapshot().evidenceLedger).toEqual(['knowledge:c1', 'knowledge:c2']);
    });

    it('records capability request ids idempotently', () => {
        const stateAdapter = adapter();
        stateAdapter.onCapabilityRequest('followup:1');
        stateAdapter.onCapabilityRequest('followup:1');

        expect(stateAdapter.snapshot().capabilityRequests).toEqual(['followup:1']);
    });
});
