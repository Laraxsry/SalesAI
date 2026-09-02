import IORedis from 'ioredis';
import { shortId } from '@repo/utils';

/**
 * Redis-backed store for the pre-call survey (Görev #7): the per-share-link
 * daily question budget, and the short-lived stash of a generated tour plan
 * that `POST /prejoin/:token/finalize` produces and `mintSession` consumes.
 *
 * Its own module (not in the route or in share-link-sessions.js) so both the
 * prejoin route and mintSession can import it without a cycle. Lazy,
 * error-swallowing client — same posture as packages/rag/src/retrieve.js.
 */
let redis = null;
function getRedis() {
    if (!redis) {
        redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: 1,
            enableReadyCheck: false,
            lazyConnect: true
        });
        redis.on('error', () => {});
        redis.connect().catch(() => {});
    }
    return redis;
}

const DAILY_LIMIT = Number(process.env.PRECALL_SURVEY_DAILY_LIMIT || 300);
const PLAN_TTL_SEC = 15 * 60;

/** True while this share link is still under its per-day survey budget. */
export async function underDailyLimit(shareToken) {
    try {
        const day = new Date().toISOString().slice(0, 10);
        const key = `prejoin:survey:count:${shareToken}:${day}`;
        const n = await getRedis().incr(key);
        if (n === 1) await getRedis().expire(key, 26 * 60 * 60);
        return n <= DAILY_LIMIT;
    } catch {
        return true; // Redis down — don't block visitors on the cap
    }
}

/** Stash a generated plan; returns an opaque token or null if Redis is down. */
export async function stashPlan({ shareToken, intent, plan }) {
    const planToken = shortId(24);
    try {
        await getRedis().set(
            `prejoin:plan:${planToken}`,
            JSON.stringify({ shareToken, intent, plan }),
            'EX',
            PLAN_TTL_SEC
        );
        return planToken;
    } catch {
        return null;
    }
}

/**
 * One-shot: pull + delete the stashed plan for a token, verified against the
 * share link it was made for. Called by mintSession only.
 */
export async function consumePlanToken(planToken, shareToken) {
    if (!planToken) return null;
    try {
        const raw = await getRedis().get(`prejoin:plan:${planToken}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed.shareToken !== shareToken) return null;
        await getRedis().del(`prejoin:plan:${planToken}`);
        return { intent: parsed.intent, plan: parsed.plan };
    } catch {
        return null;
    }
}
