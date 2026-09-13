/** Monitoring must never change a browser action's outcome. */
export function safeTourMonitor(onEvent = () => {}) {
    return (event, meta = {}) => {
        try { onEvent(event, meta)?.catch?.(() => {}); } catch { /* Non-fatal observer. */ }
    };
}

// Do not record form values, arbitrary key input, URLs, or full tool arguments.
export function tourActionMeta(action, args = {}) {
    const navigationKeys = ['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'];
    return { action, uid: args.uid ?? null,
        ...(action === 'pressKey' ? { key: navigationKeys.includes(args.key) ? args.key : '[redacted]' } : {}) };
}
