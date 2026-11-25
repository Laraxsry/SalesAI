export function isValidEmbedSession(session) {
    return Boolean(session?.sessionId && session?.roomName && session?.token && session?.livekitUrl);
}

export function resolveEmbedParentOrigin(searchParams, referrer = '') {
    const declaredOrigin = searchParams.get('parentOrigin');

    try {
        const declared = declaredOrigin ? new URL(declaredOrigin).origin : null;
        const referred = referrer ? new URL(referrer).origin : null;
        if (declared && referred && declared !== referred) return null;
        return declared || referred;
    } catch {
        return null;
    }
}

/**
 * Normalizes the SDK's `salesai:embed:layout` message. The loader owns the
 * panel size; anything malformed reads as "compact, can't expand" so the
 * expand button simply stays hidden.
 */
export function parseEmbedLayout(data) {
    return { expanded: data?.expanded === true, canExpand: data?.canExpand === true };
}
