import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

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

/** Enqueues a job onto a named queue. */
export function enqueue(name, jobName, data, opts = {}) {
    return getQueue(name).add(jobName, data, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        ...opts
    });
}

/** Creates a worker that processes jobs from a named queue. */
export function createWorker(name, processor, opts = {}) {
    return new Worker(name, processor, { connection, concurrency: 4, ...opts });
}

export { QueueEvents, connection };
