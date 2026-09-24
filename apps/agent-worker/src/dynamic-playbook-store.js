import {
    createDynamicPlaybookState,
    reduceDynamicPlaybookState
} from './dynamic-playbook-state.js';

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

/**
 * Session-scoped state owner. It is the only mutable cell in the dynamic
 * playbook domain; consumers can dispatch events and read frozen snapshots,
 * but cannot mutate reducer state themselves.
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {object} input.contract
 * @param {(transition:{event:object, previous:object, current:object})=>void} [input.onTransition]
 */
export function createDynamicPlaybookStore({
    sessionId,
    contract,
    onTransition = () => {}
}) {
    let state = deepFreeze(createDynamicPlaybookState({ sessionId, contract }));

    return {
        dispatch(event) {
            const previous = state;
            const reduced = reduceDynamicPlaybookState(previous, event);
            if (reduced === previous) return state;

            state = deepFreeze(reduced);
            try {
                onTransition({ event, previous, current: state });
            } catch {
                // Observability must never break a live conversation.
            }
            return state;
        },

        snapshot() {
            return state;
        }
    };
}
