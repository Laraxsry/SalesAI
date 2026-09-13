const INITIAL_PRESENTATION_STATE = Object.freeze({
    cue: null,
    lastEmittedAt: 0,
    viewVersion: -1
});

export function decodePresentationMessage(payload) {
    try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        return message?.type === 'salesai:presentation' ? message : null;
    } catch {
        return null;
    }
}

export function applyPresentationMessage(state = INITIAL_PRESENTATION_STATE, message) {
    if (!message || message.type !== 'salesai:presentation') return state;
    const emittedAt = Number(message.emittedAt || 0);
    const viewVersion = Number(message.viewVersion ?? state.viewVersion);
    if (emittedAt < state.lastEmittedAt || viewVersion < state.viewVersion) return state;
    return {
        cue: message.action === 'clear' ? null : message,
        lastEmittedAt: emittedAt,
        viewVersion
    };
}

export { INITIAL_PRESENTATION_STATE };
