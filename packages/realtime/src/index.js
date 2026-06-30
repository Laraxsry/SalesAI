import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';

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
    const pub = new IORedis(url);
    const sub = pub.duplicate();
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
