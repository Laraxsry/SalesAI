function normalizeRoute(route, label) {
    if (!route || typeof route !== 'object') throw new TypeError(`${label} model route is required`);
    if (typeof route.provider !== 'string' || !route.provider.trim()) {
        throw new TypeError(`${label} model provider is required`);
    }
    if (typeof route.model !== 'string' || !route.model.trim()) {
        throw new TypeError(`${label} model is required`);
    }
    const timeoutMs = Number(route.timeoutMs);
    const maxOutputTokens = Number(route.maxOutputTokens);
    const concurrencyClass = route.concurrencyClass ?? 'turn_background';
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 120000) {
        throw new TypeError(`${label} timeoutMs is invalid`);
    }
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 100000) {
        throw new TypeError(`${label} maxOutputTokens is invalid`);
    }
    if (!['realtime', 'turn_background', 'post_session'].includes(concurrencyClass)) {
        throw new TypeError(`${label} concurrencyClass is invalid`);
    }
    return Object.freeze({
        provider: route.provider.trim(),
        model: route.model.trim(),
        timeoutMs,
        maxOutputTokens,
        concurrencyClass
    });
}

export function createModelRouter({ routes = {}, defaultRoute } = {}) {
    const fallback = normalizeRoute(defaultRoute, 'default');
    const normalizedRoutes = new Map(Object.entries(routes)
        .map(([analystId, route]) => [analystId, normalizeRoute(route, analystId)]));

    return Object.freeze({
        resolve(analystId) {
            return normalizedRoutes.get(analystId) ?? fallback;
        }
    });
}
