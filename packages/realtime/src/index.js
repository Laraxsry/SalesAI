import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';

/** Shared Redis pub channel used by publishEvent(). */
const EMIT_CHANNEL = 'rt:emit';

/**
 * Creates a Socket.IO server with a Redis adapter so it scales across pods.
 * Used for console live updates (ingestion progress, session events).
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

    return io;
}

/** Socket.IO event names emitted to the console UI. */
export const RT_EVENTS = Object.freeze({
    INGESTION_PROGRESS: 'ingestion:progress',
    INGESTION_READY: 'ingestion:ready',
    SESSION_STARTED: 'session:started',
    SESSION_ENDED: 'session:ended',
    SESSION_TRANSCRIPT: 'session:transcript'
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
