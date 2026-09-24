/** Global kill-switch plus cohort/session safety; the active session supplies its own agent/product. */
export function canExecuteDynamicRoute({ enabled, cohort, multiParticipant }) {
    return enabled === true && cohort === 'canary' && multiParticipant !== true;
}
