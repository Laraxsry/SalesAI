import rateLimit from 'express-rate-limit';

/**
 * Rate limiters for the public endpoints that had no protection at all
 * (Phase 7 — "rate limiting ... across all public endpoints"). Applied
 * per-route, not as a path-prefix `app.use`: public and authenticated
 * routes are interleaved within the same router files, so a prefix mount
 * would also throttle authenticated traffic the md doesn't ask to limit
 * here. `POST /auth/login` (custom per-email lockout), `POST /sessions`,
 * and `POST /embed/:token/session` already have their own protection —
 * not duplicated here.
 */

/** Account creation / token refresh: stricter — the classic brute-force/spam surface. */
export const authRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again in a minute.' }
});

/** Unauthenticated chat: each request costs a real RAG lookup + LLM call. */
export const chatRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again in a minute.' }
});

/** Cheap reads (transcript lookup, the static SDK loader) — generous limit, mainly anti-scraping. */
export const lightPublicRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again in a minute.' }
});
