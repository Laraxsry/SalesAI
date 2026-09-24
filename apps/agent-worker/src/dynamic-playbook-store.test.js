import { describe, expect, it, vi } from 'vitest';
import { compileLegacyPlaybook } from '@repo/contracts';
import { createDynamicPlaybookStore } from './dynamic-playbook-store.js';

function contract() {
    return compileLegacyPlaybook([{
        id: 'intro',
        order: 1,
        type: 'narrative',
        directive: 'Şirketi tanıt',
        url: null,
        actions: [],
        mode: 'situational',
        survey: null
    }], { contractId: 'contract:1' });
}

describe('createDynamicPlaybookStore', () => {
    it('owns one frozen state snapshot', () => {
        const store = createDynamicPlaybookStore({ sessionId: 'session-1', contract: contract() });
        const state = store.snapshot();

        expect(Object.isFrozen(state)).toBe(true);
        expect(Object.isFrozen(state.route)).toBe(true);
        expect(() => state.route.push({})).toThrow();
    });

    it('notifies only for state-changing events', () => {
        const onTransition = vi.fn();
        const store = createDynamicPlaybookStore({
            sessionId: 'session-1',
            contract: contract(),
            onTransition
        });

        store.dispatch({ type: 'UNKNOWN' });
        store.dispatch({ type: 'NODE_STARTED', nodeId: 'missing' });
        store.dispatch({ type: 'NODE_STARTED', nodeId: 'intro' });

        expect(onTransition).toHaveBeenCalledTimes(1);
        expect(onTransition.mock.calls[0][0].event.type).toBe('NODE_STARTED');
    });

    it('does not let an observability failure escape dispatch', () => {
        const store = createDynamicPlaybookStore({
            sessionId: 'session-1',
            contract: contract(),
            onTransition: () => { throw new Error('timeline unavailable'); }
        });

        expect(() => store.dispatch({ type: 'NODE_STARTED', nodeId: 'intro' })).not.toThrow();
        expect(store.snapshot().activeNodeId).toBe('intro');
    });
});
