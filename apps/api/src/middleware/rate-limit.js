import IORedis from 'ioredis';
import { Logger } from '@repo/logger';

/**
 * Redis Token Bucket Rate Limiter (Phase 5)
 *
 * Public embed endpoints are open to anonymous traffic and every session
 * costs real money (LiveKit + realtime LLM). This middleware performs an
 * atomic per-request token-bucket check in Redis.
 *
 * How the token bucket works:
 * - Each key (e.g. "rl:embed-session:ip:1.2.3.4") represents one bucket.
 * - A bucket holds `capacity` tokens and refills at `refillPerSec` per second.
 * - Each request spends 1 token; an empty bucket rejects the request with 429.
 * - Unlike a fixed window, this allows short bursts up to capacity while
 *   still bounding the long-run rate to the refill rate.
 *
 * Atomicity: the read-compute-write cycle runs as a single Lua script inside
 * Redis, so concurrent requests never race each other.
 *
 * Fail-open: if Redis is unreachable, requests are NOT blocked (uptime over
 * strictness) — only a warning is logged. A sustained Redis outage will
 * already be visible via /ready (Phase 7).
 */

const TOKEN_BUCKET_LUA = `
local tokens_key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

local state = redis.call('HMGET', tokens_key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil then
    tokens = capacity
    ts = now_ms
end

tokens = math.min(capacity, tokens + ((now_ms - ts) / 1000) * refill_per_sec)

local allowed = 0
if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
end

redis.call('HSET', tokens_key, 'tokens', tokens, 'ts', now_ms)
-- The bucket key expires from Redis if left unused for 2x its full-refill time.
redis.call('PEXPIRE', tokens_key, math.ceil((capacity / refill_per_sec) * 2000))

return allowed
`;

let redis;

/** Lazily creates the shared Redis connection (same pattern as @repo/queue). */
function getRedis() {
    if (!redis) {
        redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: 1,
            enableReadyCheck: false
        });
        // Avoid unhandled 'error' events crashing the API when Redis is down;
        // the middleware fails open per request instead.
        redis.on('error', () => {});
        redis.defineCommand('takeToken', { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
    }
    return redis;
}

/**
 * Express middleware factory.
 *
 * @param {object} opts
 * @param {string} opts.name - namespace for Redis keys (e.g. 'embed-session')
 * @param {(req: import('express').Request) => string | null} opts.keyFn
 *        Extracts the bucket identity from the request (e.g. client IP or
 *        Origin host). Returning null skips limiting for that request.
 * @param {number | ((req: import('express').Request) => number)} opts.capacity
 *        Max burst size (tokens in a full bucket). A function reads a
 *        per-tenant limit off the request (e.g. an EmbedConfig loaded by an
 *        earlier middleware) instead of a single global constant.
 * @param {number | ((req: import('express').Request) => number)} opts.refillPerSec
 *        Sustained allowed rate, tokens/second. Same static-or-per-request shape as `capacity`.
 */
export function rateLimit({ name, keyFn, capacity, refillPerSec }) {
    return async (req, res, next) => {
        let key;
        try {
            const identity = keyFn(req);
            if (!identity) return next();
            key = `rl:${name}:${identity}`;

            const cap = typeof capacity === 'function' ? capacity(req) : capacity;
            const refill = typeof refillPerSec === 'function' ? refillPerSec(req) : refillPerSec;

            const allowed = await getRedis().takeToken(key, cap, refill, Date.now());
            if (allowed === 1) return next();

            // In a token bucket, the next token becomes available after 1/refill seconds.
            res.set('Retry-After', String(Math.ceil(1 / refill)));
            return res.status(429).json({ error: 'RateLimited', message: 'Too many requests' });
        } catch (err) {
            Logger.warn('rate-limit check failed (failing open)', { key, error: err?.message });
            return next();
        }
    };
}

/** Client IP, trust-proxy aware (Express req.ip). */
export function ipKey(req) {
    return req.ip || req.socket?.remoteAddress || null;
}
