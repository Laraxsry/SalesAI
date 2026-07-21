import { EmbedDomain } from '@repo/database';
import { matchesEmbedDomain } from '@repo/contracts';

const PREFLIGHT_MAX_AGE_SECONDS = 600;

/**
 * Extracts the request's claimed origin hostname from the `Origin` header,
 * falling back to `Referer` (some environments — e.g. certain in-app
 * webviews — omit `Origin` on simple GETs but still send `Referer`).
 *
 * Returns null if neither header is present or parseable — an embed request
 * with no way to state where it came from has nothing for the allowlist to
 * check against, so it can never be trusted regardless of token validity.
 */
export function readClaimedOrigin(req) {
    const raw = req.headers.origin || req.headers.referer;
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return { href: url.origin, hostname: url.hostname.toLowerCase() };
    } catch {
        return null;
    }
}

/**
 * True if `hostname` should bypass the domain allowlist as a local dev
 * convenience. Kept as its own pure function (rather than inlined) because a
 * flipped operator here (`!==` -> `===`) would silently open the allowlist
 * bypass in production — worth locking down with a direct test.
 */
export function isLocalhostAllowedInDev(hostname, nodeEnv) {
    return nodeEnv !== 'production' && hostname === 'localhost';
}

/**
 * Enforces the widget's origin allowlist and sets per-request CORS headers.
 *
 * Must run after `resolveEmbedContext` (needs `req.embed.agent`). This is the
 * layer md/backend/phase5 calls out explicitly as advisory-only: the `Origin`
 * header is exactly what the calling browser claims, not a cryptographic
 * fact — a non-browser client can send any value it likes. It stops casual
 * cross-site embedding by a browser (the case that matters: someone copying
 * the snippet onto a domain the seller never allowlisted), and combined with
 * the rate limiter below, keeps a spoofed direct caller from doing more than
 * a single request's worth of damage. It is not, by itself, an auth check.
 *
 * Also terminates CORS preflight (`OPTIONS`) requests here, before any route
 * handler runs, since the global `cors()` in main.js is intentionally scoped
 * away from `/api/v1/embed` — the allowed origin here is per-agent data from
 * `EmbedDomain`, not the app-wide static `CORS_ORIGIN` list, so it can only
 * be decided after resolving which agent the token belongs to.
 */
export async function enforceEmbedOrigin(req, res, next) {
    const claimed = readClaimedOrigin(req);
    if (!claimed) return res.status(403).json({ error: 'Origin required' });

    let allowed = isLocalhostAllowedInDev(claimed.hostname, process.env.NODE_ENV);
    if (!allowed) {
        const domains = await EmbedDomain.find({ agentId: req.embed.agent._id }, 'domain').lean();
        allowed = domains.some((d) => matchesEmbedDomain(claimed.hostname, d.domain));
    }

    if (!allowed) return res.status(403).json({ error: 'Origin not allowed for this agent' });

    res.set('Access-Control-Allow-Origin', claimed.href);
    res.set('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', String(PREFLIGHT_MAX_AGE_SECONDS));
        return res.sendStatus(204);
    }

    req.embed.originHostname = claimed.hostname;
    next();
}
