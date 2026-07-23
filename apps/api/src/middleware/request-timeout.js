/**
 * Ends the response with 503 if a request hasn't finished within `ms`
 * (Phase 7 — "request timeouts ... across all public endpoints"). A public
 * route with no bound on how long it can run ties up a connection
 * indefinitely on a stuck DB query or a slow upstream call, and gives the
 * caller no signal that anything went wrong — they just wait forever.
 *
 * Applied per-route (not as a blanket `app.use`) since public and
 * authenticated routes are interleaved within the same router files — a
 * path-prefix mount would catch authenticated routes too, which the md
 * scopes this to public endpoints only.
 *
 * @param {number} ms
 */
export function requestTimeout(ms) {
    return (req, res, next) => {
        const timer = setTimeout(() => {
            if (res.headersSent) return; // response already started (e.g. streaming) — nothing safe to do
            res.status(503).json({
                error: 'RequestTimeout',
                message: `Request did not complete within ${ms}ms`
            });
        }, ms);

        // Whichever finishes first — the real response or the timeout —
        // the other one's cleanup is a no-op: clearTimeout on an already-
        // fired timer, or res.status()/json() after the client is long gone.
        res.on('finish', () => clearTimeout(timer));
        res.on('close', () => clearTimeout(timer));
        next();
    };
}
