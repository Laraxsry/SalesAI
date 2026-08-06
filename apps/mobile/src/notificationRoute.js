const ALLOWED_PATHS = [
    /^\/v\/[^/?#]+$/,
    /^\/saved(?:\/[^/?#]+)?$/,
    /^\/console\/session\/[^/?#]+$/,
    /^\/auth\/verify(?:\?token=[^#]+)?$/,
];

function asAppPath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const candidate = value.trim();

    try {
        if (candidate.startsWith('salesai://')) {
            const url = new URL(candidate);
            return `/${url.host}${url.pathname}${url.search}`;
        }
        if (/^https?:\/\//.test(candidate)) {
            const url = new URL(candidate);
            return `${url.pathname}${url.search}`;
        }
    } catch {
        return null;
    }

    return candidate.startsWith('/') ? candidate : `/${candidate}`;
}

export function getNotificationRoute(data = {}) {
    const explicit = asAppPath(data.route || data.path || data.url);
    if (explicit && ALLOWED_PATHS.some((pattern) => pattern.test(explicit))) return explicit;
    if (data.shareToken) return `/v/${encodeURIComponent(String(data.shareToken))}`;
    if (data.sessionId) return `/saved/${encodeURIComponent(String(data.sessionId))}`;
    return null;
}
