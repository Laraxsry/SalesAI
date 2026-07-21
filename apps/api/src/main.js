import '@repo/config-env/load';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Logger } from '@repo/logger';
import { connectDB } from '@repo/database';
import { ensureBucket } from '@repo/storage';
import { createRealtimeServer } from '@repo/realtime';
import IORedis from 'ioredis';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';

const PORT = Number(process.env.API_PORT || 5001);

async function main() {
    await connectDB();
    await ensureBucket();

    const app = express();
    app.use(helmet());
    // The embed router (Phase 5) is deliberately excluded from this static,
    // env-driven CORS policy: its allowed origins come from each agent's own
    // EmbedDomain allowlist in Mongo, resolved per-request, not from a fixed
    // CORS_ORIGIN list. The `cors` package short-circuits every OPTIONS
    // request as soon as it's mounted — including ones outside its allowed
    // list — so leaving it in front of /api/v1/embed would swallow the
    // preflight before enforceEmbedOrigin ever got to apply the per-agent
    // check. The embed router sets its own CORS headers instead (see
    // apps/api/src/middleware/embed-origin.js).
    const corsMiddleware = cors({ origin: (process.env.CORS_ORIGIN || '').split(',').filter(Boolean) });
    app.use((req, res, next) => (req.path.startsWith('/api/v1/embed') ? next() : corsMiddleware(req, res, next)));
    app.use(express.json({ limit: '5mb' }));

    app.get('/health', (_req, res) => res.json({ ok: true, service: 'api' }));
    registerRoutes(app);

    // Global error handler — tüm yakalanmamış hataları yakalar
    app.use(errorHandler);

    const server = http.createServer(app);
    const io = createRealtimeServer(server);
    app.set('io', io);

    server.listen(PORT, () => Logger.info(`API listening on :${PORT}`));

    // Forward worker-published RT events to Socket.IO clients via Redis sub.
    const redisSub = new IORedis(
        process.env.REDIS_URL || 'redis://localhost:6379',
        { maxRetriesPerRequest: null, enableReadyCheck: false }
    );
    redisSub.on('error', () => {});
    redisSub.subscribe('rt:emit');
    redisSub.on('message', (_ch, raw) => {
        try {
            const { event, payload } = JSON.parse(raw);
            io.emit(event, payload);
        } catch { /* malformed — ignore */ }
    });
}

main().catch((err) => {
    Logger.error('API failed to start', { error: err });
    process.exit(1);
});
