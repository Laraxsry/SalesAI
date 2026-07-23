import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';

/** Shared Redis pub channel used by publishEvent(). */
const EMIT_CHANNEL = 'rt:emit';

/**
 * Creates a Socket.IO server with a Redis adapter so it scales across pods.
 * Used for console live updates (ingestion progress, session events).
 *
 * Returns `{ io, close }` rather than the bare `io` instance — the adapter's
 * `pub`/`sub` Redis connections are created and owned here, so the caller
 * has no other way to close them during a graceful shutdown. `close()`
 * closes the Socket.IO server (disconnecting clients) and quits both Redis
 * connections.
 *
 * @param {import('http').Server} httpServer
 * @param {{ cors?: object }} [opts]
 */
export function createRealtimeServer(httpServer, opts = {}) {
    const io = new Server(httpServer, {
        cors: opts.cors || { origin: (process.env.CORS_ORIGIN || '').split(',') }
    });

    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    // maxRetriesPerRequest:null keeps the process alive while Redis is briefly
    // unavailable (e.g. before `npm run infra:up`) instead of throwing.
    const redisOpts = { maxRetriesPerRequest: null, enableReadyCheck: false };
    const pub = new IORedis(url, redisOpts);
    const sub = pub.duplicate();
    // Without an 'error' listener ioredis throws "Unhandled error event" and
    // can crash the server when Redis is down.
    pub.on('error', () => {});
    sub.on('error', () => {});
    io.adapter(createAdapter(pub, sub));

    async function close() {
        await new Promise((resolve) => io.close(() => resolve()));
        pub.disconnect();
        sub.disconnect();
    }

    return { io, close };
}

/** Socket.IO event names emitted to the console UI. */
export const RT_EVENTS = Object.freeze({
    INGESTION_PROGRESS: 'ingestion:progress',
    INGESTION_READY: 'ingestion:ready',
    SESSION_STARTED: 'session:started',
    SESSION_ENDED: 'session:ended',
    SESSION_TRANSCRIPT: 'session:transcript',
    // Phase 4: Analytics & Insights
    SESSION_SUMMARY: 'session:summary',    // post-call özet hazır (03_data_model_and_api.md)
    LEAD_CAPTURED: 'lead:captured'         // yeni lead yakalandı
});

/**
 * Publishes a Socket.IO event from any process (worker, agent-worker…) via Redis.
 * The API process listens on EMIT_CHANNEL and forwards events to Socket.IO clients.
 *
 * @param {string} event   - RT_EVENTS constant
 * @param {object} payload - Serialisable payload
 */
export async function publishEvent(event, payload) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new IORedis(url, { maxRetriesPerRequest: 1, enableReadyCheck: false });
    redis.on('error', () => {});
    try {
        await redis.publish(EMIT_CHANNEL, JSON.stringify({ event, payload }));
    } finally {
        redis.disconnect();
    }
}

/**
 * Dedicated channel for operational metric observations (Phase 7), separate
 * from EMIT_CHANNEL: RT_EVENTS/publishEvent are visitor/console-facing
 * realtime UI events; this is internal telemetry consumed only by apps/api's
 * Prometheus registry. Exported so subscribers don't hardcode the literal.
 */
export const METRICS_CHANNEL = 'rt:metrics';

/** Metric names published via publishMetric(), shared vocabulary between agent-worker and apps/api. */
export const SESSION_METRICS = Object.freeze({
    SESSION_JOIN_MS: 'session_join_ms',
    FIRST_AUDIO_MS: 'first_audio_ms',
    TOOL_CALL_MS: 'tool_call_ms',
    SESSION_COST_USD: 'session_cost_usd'
});

// Lazily created and reused rather than one-shot per call like publishEvent()
// — tool-call/first-audio metrics can fire many times within a single
// session, and reopening a Redis connection per observation would be wasteful.
let metricsPublisher;
function getMetricsPublisher() {
    if (!metricsPublisher) {
        const url = process.env.REDIS_URL || 'redis://localhost:6379';
        metricsPublisher = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
        metricsPublisher.on('error', () => {});
    }
    return metricsPublisher;
}

/**
 * Publishes a single metric observation from any process (agent-worker,
 * workers…) for apps/api to fold into its Prometheus registry (Phase 7).
 * Fire-and-forget: a dropped metric observation should never affect the
 * session it was measuring, so failures are swallowed rather than thrown.
 *
 * @param {string} name - one of SESSION_METRICS
 * @param {number} value - the observed value (unit is name-specific, e.g. milliseconds)
 * @param {object} [labels] - low-cardinality labels only (e.g. tool name, provider) — never sessionId/roomName/userId
 */
export function publishMetric(name, value, labels = {}) {
    return getMetricsPublisher()
        .publish(METRICS_CHANNEL, JSON.stringify({ name, value, labels }))
        .catch(() => {});
}

/**
 * Dedicated channel for usage observations that must durably become a real
 * `UsageRecord` (Phase 6 billing ledger) — separate from METRICS_CHANNEL,
 * whose observations only ever become in-memory Prometheus histograms. A
 * dropped metric is an acceptable loss; a dropped usage/billing event is not,
 * so this is kept as its own concern even though the transport looks similar.
 */
export const USAGE_CHANNEL = 'rt:usage';

let usagePublisher;
function getUsagePublisher() {
    if (!usagePublisher) {
        const url = process.env.REDIS_URL || 'redis://localhost:6379';
        usagePublisher = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
        usagePublisher.on('error', () => {});
    }
    return usagePublisher;
}

/**
 * Publishes one usage observation (Phase 7 cost tracking, Phase 6 billing)
 * from any process for apps/api to fold into the real `UsageRecord`/
 * `Subscription` ledger via billing-service's `recordUsage()`.
 *
 * @param {{workspaceId:string, meter:string, quantity:number, estCost?:number, sessionId?:string, agentId?:string}} usage
 */
export function publishUsage(usage) {
    return getUsagePublisher()
        .publish(USAGE_CHANNEL, JSON.stringify(usage))
        .catch(() => {});
}
