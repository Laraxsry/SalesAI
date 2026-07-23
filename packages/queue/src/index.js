import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';
import { context, propagation } from '@opentelemetry/api';
import { Logger } from '@repo/logger';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
});
// Avoid "Unhandled error event" crashing the worker process when Redis is down;
// BullMQ keeps retrying and recovers once Redis is reachable.
connection.on('error', () => {});

/** Canonical queue names used across the platform. */
export const QUEUES = Object.freeze({
    INGESTION: 'ingestion',
    GENERAL: 'general'
});

const queues = new Map();

/** Returns (and lazily creates) a BullMQ queue by name. */
export function getQueue(name) {
    if (!queues.has(name)) {
        queues.set(name, new Queue(name, { connection }));
    }
    return queues.get(name);
}

/**
 * Enqueues a job onto a named queue.
 *
 * Stashes the *calling* request's OpenTelemetry trace context into the job
 * payload (Phase 7). BullMQ jobs cross a process boundary (API -> Redis ->
 * worker), so there's no in-memory call stack connecting them the way a
 * normal function call has — without this, every job would start its own,
 * disconnected trace instead of continuing the one that enqueued it.
 */
export function enqueue(name, jobName, data, opts = {}) {
    const traceContext = {};
    propagation.inject(context.active(), traceContext);
    return getQueue(name).add(jobName, { ...data, __traceContext: traceContext }, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        ...opts
    });
}

/** True once a job has consumed its last configured retry attempt. */
export function isFinalFailure(job) {
    const maxAttempts = job?.opts?.attempts ?? 1;
    return (job?.attemptsMade ?? 0) >= maxAttempts;
}

/**
 * Default dead-letter sink: writes the poison job to `DeadLetterJob` so it's
 * queryable/alertable instead of sitting invisibly in BullMQ's own internal
 * failed-job list. Imports `@repo/database` dynamically (not statically) so
 * this generic queue package doesn't take a hard dependency on the
 * domain-specific database package — the same lazy-import convention already
 * used elsewhere in this codebase (e.g. routes' `await import('@repo/database')`).
 */
export async function defaultOnDeadLetter({ queueName, job, error }) {
    const { DeadLetterJob } = await import('@repo/database');
    await DeadLetterJob.create({
        queueName,
        jobName: job.name,
        jobId: String(job.id),
        data: job.data,
        failedReason: error?.message ?? String(error),
        attemptsMade: job.attemptsMade
    });
}

/**
 * Creates a worker that processes jobs from a named queue.
 *
 * Runs `processor` inside the trace context `enqueue` stashed on the job
 * (falling back to a fresh context for jobs enqueued before this shipped, or
 * enqueued directly via BullMQ without going through `enqueue`). `job.data`
 * itself is left untouched — most processors destructure only the fields
 * they know about, so the extra `__traceContext` key is harmless to them.
 *
 * On a job's final failed attempt (Phase 7 — dead-letter queue for poison
 * jobs), calls `onDeadLetter` so the failure is recorded somewhere queryable
 * rather than only living in BullMQ's internal failed-job list. Defaults to
 * `defaultOnDeadLetter`; tests/callers can override it.
 */
export function createWorker(name, processor, opts = {}) {
    const { onDeadLetter = defaultOnDeadLetter, ...workerOpts } = opts;
    const tracedProcessor = (job) => {
        const parentContext = job.data?.__traceContext
            ? propagation.extract(context.active(), job.data.__traceContext)
            : context.active();
        return context.with(parentContext, () => processor(job));
    };
    const worker = new Worker(name, tracedProcessor, { connection, concurrency: 4, ...workerOpts });

    worker.on('failed', (job, error) => {
        if (!job || !isFinalFailure(job)) return;
        onDeadLetter({ queueName: name, job, error }).catch((dlqError) => {
            Logger.error('failed to write dead-letter job', {
                queueName: name,
                jobId: job.id,
                error: dlqError.message
            });
        });
    });

    return worker;
}

export { QueueEvents, Job, connection };
