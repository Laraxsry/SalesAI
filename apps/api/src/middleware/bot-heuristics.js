/**
 * Lightweight, dependency-free bot filter for the public embed session
 * endpoint (`POST /embed/:token/session`). Every session costs real money
 * (LiveKit + realtime LLM), so it's worth rejecting the obvious case —
 * scripts and HTTP libraries calling the endpoint directly — before a real
 * captcha challenge is warranted (see md/backend/phase5: hCaptcha/Turnstile
 * is deferred until the widget frontend, web Phase 6, exists to host it).
 *
 * This is a heuristic, not a security boundary: a motivated bot can always
 * spoof a browser User-Agent. It only raises the bar for casual/naive
 * scripted abuse, same spirit as the Origin check in embed-origin.js.
 */

const SUSPICIOUS_UA_PATTERNS = [
    /curl/i,
    /wget/i,
    /python-requests/i,
    /python-urllib/i,
    /go-http-client/i,
    /okhttp/i,
    /java\//i,
    /axios\//i,
    /node-fetch/i,
    /postmanruntime/i,
    /insomnia/i,
    /scrapy/i,
    /headlesschrome/i,
    /phantomjs/i,
    /bot/i,
    /spider/i,
    /crawler/i
];

/** True if `userAgent` looks like a script/HTTP-library client rather than a browser. */
export function isSuspiciousUserAgent(userAgent) {
    if (!userAgent || typeof userAgent !== 'string' || !userAgent.trim()) return true;
    return SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
}

/** Rejects requests with a missing or known-non-browser User-Agent. */
export function blockSuspiciousBots(req, res, next) {
    if (isSuspiciousUserAgent(req.headers['user-agent'])) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}
