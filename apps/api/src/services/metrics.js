import client from 'prom-client';
import IORedis from 'ioredis';
import { getQueue, QUEUES, QueueEvents, Job } from '@repo/queue';
import { METRICS_CHANNEL, SESSION_METRICS } from '@repo/realtime';
import { Logger } from '@repo/logger';

/**
 * Prometheus RED metrics (Rate, Errors, Duration) for GET /metrics (Phase 7).
 *
 * A dedicated Registry (not the global default) so this module can be
 * imported by tests without polluting/duplicating metrics across test runs.
 */
export const register = new client.Registry();
client.collectDefaultMetrics({ register }); // process CPU/memory/event-loop lag, for free

export const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests received',
    labelNames: ['method', 'route', 'status'],
    registers: [register]
});

export const httpRequestDurationSeconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register]
});

/**
 * The route label to record for a request — the matched route *pattern*
 * (e.g. "/api/v1/agents/:id/sessions"), not the literal URL. Recording raw
 * URLs would create a separate Prometheus time series per unique ID/token
 * ever requested — unbounded cardinality that grows forever and can
 * overwhelm Prometheus. Falls back to the raw path only for unmatched (404)
 * requests, where there's no route pattern to group by.
 */
export function routeLabel(req) {
    return req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
}

/** Records RED metrics for every request that reaches the API. */
export function metricsMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        const labels = { method: req.method, route: routeLabel(req), status: res.statusCode };
        httpRequestsTotal.inc(labels);
        httpRequestDurationSeconds.observe(labels, durationSeconds);
    });
    next();
}

/**
 * Queue depth (Phase 7) — how many jobs are sitting in each BullMQ state per
 * queue, computed fresh on every /metrics scrape rather than polled on a
 * timer. `collect()` supports async (prom-client awaits it), so this is a
 * plain `getJobCounts()` call against the same Redis every Queue already
 * uses — no separate polling loop to manage or leak.
 */
const QUEUE_DEPTH_STATES = ['waiting', 'active', 'delayed', 'failed'];

export const queueDepth = new client.Gauge({
    name: 'queue_depth',
    help: 'Number of BullMQ jobs per queue and state',
    labelNames: ['queueName', 'state'],
    registers: [register],
    async collect() {
        for (const queueName of Object.values(QUEUES)) {
            const counts = await getQueue(queueName).getJobCounts(...QUEUE_DEPTH_STATES);
            for (const state of QUEUE_DEPTH_STATES) {
                this.set({ queueName, state }, counts[state] ?? 0);
            }
        }
    }
});

/** Job latency (Phase 7) — end-to-end duration from enqueue to completion/failure. */
export const jobDurationSeconds = new client.Histogram({
    name: 'job_duration_seconds',
    help: 'End-to-end BullMQ job duration (enqueue to completion/failure) in seconds',
    labelNames: ['queueName', 'jobName', 'status'],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [register]
});

/** Pure: end-to-end duration in seconds for a finished BullMQ job. */
export function computeJobDurationSeconds(job) {
    return (job.finishedOn - job.timestamp) / 1000;
}

const queueMetricsCleanupFns = [];

/**
 * Starts one `QueueEvents` listener per known queue, observing each job's
 * end-to-end duration into `jobDurationSeconds` on completion/failure.
 * `QueueEvents` requires its own dedicated Redis connection — it blocks the
 * connection to stream events, so it can never share `@repo/queue`'s
 * connection the way `Queue`/`Worker` do. Call once at startup; returns
 * nothing, but registers cleanup for `closeQueueMetrics()`.
 */
export function observeQueueMetrics() {
    for (const queueName of Object.values(QUEUES)) {
        const queue = getQueue(queueName);
        const eventsConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
            enableReadyCheck: false
        });
        eventsConnection.on('error', () => {});
        const queueEvents = new QueueEvents(queueName, { connection: eventsConnection });
        queueEvents.on('error', () => {});

        const record = async (jobId, status) => {
            const job = await Job.fromId(queue, jobId);
            if (!job || job.finishedOn === undefined || job.finishedOn === null) return;
            jobDurationSeconds.observe({ queueName, jobName: job.name, status }, computeJobDurationSeconds(job));
        };
        queueEvents.on('completed', ({ jobId }) => record(jobId, 'completed').catch(() => {}));
        queueEvents.on('failed', ({ jobId }) => record(jobId, 'failed').catch(() => {}));

        queueMetricsCleanupFns.push(() => Promise.all([queueEvents.close(), eventsConnection.quit()]));
    }
}

/** Closes every `QueueEvents` listener and its dedicated connection (graceful shutdown). */
export function closeQueueMetrics() {
    return Promise.all(queueMetricsCleanupFns.splice(0).map((close) => close()));
}

/**
 * Session-level latency (Phase 7) — session join time, first-audio latency,
 * and tool-call duration all happen inside the agent-worker process, which
 * is LiveKit-dispatched (often as a forked child process per job) rather
 * than a long-lived, scrapable HTTP service. Instead of giving every
 * ephemeral agent-worker process its own Prometheus target, it publishes
 * observations over Redis pub/sub (`@repo/realtime`'s `publishMetric` /
 * `METRICS_CHANNEL` — the same cross-process mechanism already used to
 * forward realtime UI events to apps/api), and this, the one long-lived,
 * already-scraped process, folds them into its own registry.
 */
export const sessionJoinDurationSeconds = new client.Histogram({
    name: 'session_join_duration_seconds',
    help: 'Time for the agent-worker to join the visitor LiveKit room',
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [register]
});

export const firstAudioLatencySeconds = new client.Histogram({
    name: 'first_audio_latency_seconds',
    help: 'Time to first audio token per realtime-model turn',
    labelNames: ['provider'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register]
});

export const toolCallDurationSeconds = new client.Histogram({
    name: 'tool_call_duration_seconds',
    help: 'Agent tool-call handler duration',
    labelNames: ['tool', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [register]
});

/** Estimated per-session cost (Phase 7), published once at session close — already in USD, no unit conversion needed. */
export const sessionCostUsd = new client.Histogram({
    name: 'session_cost_usd',
    help: 'Estimated total cost (realtime-model tokens + vision calls) per session',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [register]
});

/**
 * Pure: routes one published session-metric observation to its histogram.
 * Returns whether the metric name was recognized, so malformed/unknown
 * messages can be ignored rather than silently mis-recorded.
 */
export function observeSessionMetric(name, value, labels = {}) {
    switch (name) {
        case SESSION_METRICS.SESSION_JOIN_MS:
            sessionJoinDurationSeconds.observe(value / 1000);
            return true;
        case SESSION_METRICS.FIRST_AUDIO_MS:
            firstAudioLatencySeconds.observe({ provider: labels.provider || 'unknown' }, value / 1000);
            return true;
        case SESSION_METRICS.TOOL_CALL_MS:
            toolCallDurationSeconds.observe({ tool: labels.tool || 'unknown', status: labels.status || 'unknown' }, value / 1000);
            return true;
        case SESSION_METRICS.SESSION_COST_USD:
            sessionCostUsd.observe(value);
            return true;
        default:
            return false;
    }
}

/**
 * Subscribes to session-metric observations published by agent-worker
 * processes. Returns the Redis subscriber connection so the caller can
 * `.quit()` it during graceful shutdown.
 */
export function subscribeSessionMetrics() {
    const sub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        enableReadyCheck: false
    });
    sub.on('error', () => {});
    sub.subscribe(METRICS_CHANNEL).catch((err) => {
        Logger.error('failed to subscribe to metrics channel', { error: err.message });
    });
    sub.on('message', (channel, raw) => {
        if (channel !== METRICS_CHANNEL) return;
        try {
            const { name, value, labels } = JSON.parse(raw);
            observeSessionMetric(name, value, labels);
        } catch { /* malformed — ignore */ }
    });
    return sub;
}
