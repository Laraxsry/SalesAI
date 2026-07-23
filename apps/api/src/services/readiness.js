import { mongoose } from '@repo/database';
import IORedis from 'ioredis';
import { roomService } from '@repo/livekit';

/**
 * Dependency checks for GET /ready (Phase 7).
 *
 * Each check is a small, independent probe of one dependency — kept as its
 * own function (rather than one big try/catch) so a single slow/down
 * dependency doesn't obscure which one is actually the problem, and so the
 * route can run them concurrently (Promise.allSettled) instead of paying
 * their timeouts one after another.
 */

/** True if the shared Mongoose connection is actually connected (readyState 1). */
export async function checkMongo() {
    return { name: 'mongodb', ok: mongoose.connection.readyState === 1 };
}

/**
 * Opens a short-lived Redis connection and pings it. Deliberately separate
 * from the app's long-lived Redis clients (queue, rate-limit, pub/sub) —
 * readiness shouldn't share fate with, or be blocked by, any one of them.
 */
export async function checkRedis() {
    const client = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true
    });
    client.on('error', () => {});
    try {
        await client.connect();
        await client.ping();
        return { name: 'redis', ok: true };
    } catch (err) {
        return { name: 'redis', ok: false, error: err.message };
    } finally {
        client.disconnect();
    }
}

/** Confirms the LiveKit server's REST API actually responds, not just that it's configured. */
export async function checkLiveKit() {
    try {
        await roomService().listRooms();
        return { name: 'livekit', ok: true };
    } catch (err) {
        return { name: 'livekit', ok: false, error: err.message };
    }
}

/**
 * Pure aggregation: turns individual check results into the /ready response
 * shape. Kept separate from the I/O above so this part — the actual
 * "are we ready" decision — is unit-testable without a real Mongo/Redis/
 * LiveKit connection.
 *
 * @param {{name: string, ok: boolean, error?: string}[]} results
 */
export function summarizeReadiness(results) {
    const checks = Object.fromEntries(results.map(({ name, ok, error }) => [name, { ok, ...(error && { error }) }]));
    const ok = results.every((r) => r.ok);
    return { ok, checks };
}
