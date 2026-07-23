import { Router } from 'express';
import { validate } from '@repo/validation';
import { EmbedSessionInput } from '@repo/contracts';
import { resolveEmbedContext } from '../middleware/embed-context.js';
import { enforceEmbedOrigin } from '../middleware/embed-origin.js';
import { blockSuspiciousBots } from '../middleware/bot-heuristics.js';
import { rateLimit, ipKey } from '../middleware/rate-limit.js';
import { requestTimeout } from '../middleware/request-timeout.js';
import { mintSession } from '../services/share-link-sessions.js';

export const embedRouter = Router();

// Applies to every method (including the OPTIONS preflight) under /:token/*,
// in this order: resolve which agent the token belongs to, then check the
// caller's Origin against that agent's allowlist and set CORS headers.
// enforceEmbedOrigin ends OPTIONS requests itself; GET/POST fall through.
embedRouter.use('/:token', resolveEmbedContext, enforceEmbedOrigin);

const embedSessionRateLimits = [
    rateLimit({
        name: 'embed-session-ip',
        keyFn: (req) => `${req.embed.agent._id}:${ipKey(req)}`,
        capacity: (req) => req.embed.embedConfig.rateCaps.sessionsPerIpPerHour,
        // rateCaps are named "PerHour"; a token bucket refilling continuously
        // at capacity/3600 tokens/sec models "N per hour" while still
        // smoothing bursts, rather than a hard sliding window.
        refillPerSec: (req) => req.embed.embedConfig.rateCaps.sessionsPerIpPerHour / 3600
    }),
    rateLimit({
        name: 'embed-session-origin',
        keyFn: (req) => `${req.embed.agent._id}:${req.embed.originHostname}`,
        capacity: (req) => req.embed.embedConfig.rateCaps.sessionsPerOriginPerHour,
        refillPerSec: (req) => req.embed.embedConfig.rateCaps.sessionsPerOriginPerHour / 3600
    })
];

/** No-secrets render config shape shared by both the config and session responses. */
function publicConfig(embedConfig) {
    const { theme, launcher, greeting, micAutoPrompt } = embedConfig;
    return { theme, launcher, greeting, micAutoPrompt };
}

/**
 * Public: render config for the loader script. No secrets — this is fetched
 * by anonymous visitor browsers before any origin-specific session exists.
 */
embedRouter.get('/:token/config', requestTimeout(5000), (req, res) => {
    res.json(publicConfig(req.embed.embedConfig));
});

/**
 * Public: mints a room exactly like POST /sessions, gated by the origin
 * allowlist above and per-IP/per-origin rate limits (real money per session:
 * LiveKit + realtime LLM). Tags the session `source: 'widget'` plus the page
 * it was opened from, so Phase 4 analytics can segment web vs. widget traffic.
 */
embedRouter.post(
    '/:token/session',
    requestTimeout(10_000),
    validate({ body: EmbedSessionInput }),
    blockSuspiciousBots,
    ...embedSessionRateLimits,
    async (req, res, next) => {
        try {
            const { visitorName, pageUrl } = req.body;
            const result = await mintSession({
                link: req.embed.link,
                agent: req.embed.agent,
                visitorName,
                source: 'widget',
                pageUrl: pageUrl || req.headers.referer,
                referrer: req.headers.referer
            });
            res.json({ ...result, config: publicConfig(req.embed.embedConfig) });
        } catch (err) {
            next(err);
        }
    }
);
