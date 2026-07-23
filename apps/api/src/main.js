import '@repo/config-env/load';
import './tracing.js'; // must run before express/mongoose/ioredis are imported below
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Logger } from '@repo/logger';
import { connectDB, disconnectDB } from '@repo/database';
import { ensureBucket } from '@repo/storage';
import { createRealtimeServer } from '@repo/realtime';
import { connection as queueConnection } from '@repo/queue';
import IORedis from 'ioredis';
import { registerRoutes } from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { checkMongo, checkRedis, checkLiveKit, summarizeReadiness } from './services/readiness.js';
import {
    register, metricsMiddleware, observeQueueMetrics, closeQueueMetrics, subscribeSessionMetrics
} from './services/metrics.js';
import { subscribeUsageEvents } from './services/usage-bridge.js';
import { backpressureMiddleware } from './middleware/backpressure.js';
import { shutdownTracing } from './tracing.js';
import { registerGracefulShutdown } from './shutdown.js';

const PORT = Number(process.env.API_PORT || 5001);

async function main() {
    await connectDB();
    await ensureBucket();

    const app = express();
    // Phase 8 Task 1.11: Güçlendirilmiş güvenlik başlıkları
    app.use(helmet({
        // HSTS: tarayıcılar 1 yıl boyunca HTTPS üzerinden iletişim kurar
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        },
        // Tarayıcı MIME tipi sniffing'i devre dışı bırak
        noSniff: true,
        // Clickjacking koruması
        frameguard: { action: 'deny' },
        // Referrer bilgisini kısıtla
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        // XSS filtresi (eski tarayıcılar için)
        xssFilter: true,
        // Content Security Policy — API için temel
        contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
    }));

    // CORS: allowlist'e göre kısıtla — production'da wildcard * yasak
    const corsMiddleware = cors({
        origin: (origin, callback) => {
            const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').filter(Boolean);
            // Dev ortamında origin'siz isteklere izin ver (Postman, curl)
            if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
                return callback(null, true);
            }
            callback(new Error(`CORS: Origin ${origin} not allowed`));
        },
        credentials: true
    });

    // Skip global CORS for embed paths
    app.use((req, res, next) => (req.path.startsWith('/api/v1/embed') ? next() : corsMiddleware(req, res, next)));

    // Phase 6: Stripe Webhook raw body parser (signature verification)
    app.use('/api/v1/billing/webhook', express.raw({ type: 'application/json' }));
    app.use(express.json({ limit: '5mb' }));
    app.use(metricsMiddleware);

    // Phase 7: backpressure — shed new requests with 503 when the event loop
    // is clearly struggling, rather than accepting unlimited work. Runs after
    // metricsMiddleware so shed requests are still counted in RED metrics.
    app.use(backpressureMiddleware());

    // Phase 8 Task 6.6: Public endpoint rate limiting
    // POST /sessions ve /embed/* — abuse ve DDoS koruması
    const sessionRateLimit = rateLimit({
        windowMs: 60 * 1000,  // 1 dakika
        max: 20,               // 20 istek/dakika/IP
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests. Please try again in a minute.' }
    });
    app.use('/api/v1/sessions', sessionRateLimit);
    app.use('/api/v1/embed', sessionRateLimit);

    // Liveness: process is up and can respond. No dependency checks —
    // must stay fast even if Mongo/Redis/LiveKit are struggling.
    app.get('/health', (_req, res) => res.json({ ok: true, service: 'api' }));

    // Scraped by Prometheus (see infra/docker-compose.yaml + infra/prometheus.yml).
    app.get('/metrics', async (_req, res) => {
        res.set('Content-Type', register.contentType);
        res.send(await register.metrics());
    });

    // Readiness: safe to receive traffic. Checked concurrently so one slow
    // dependency doesn't add its timeout on top of the others'.
    app.get('/ready', async (_req, res) => {
        const results = await Promise.all([checkMongo(), checkRedis(), checkLiveKit()]);
        const { ok, checks } = summarizeReadiness(results);
        res.status(ok ? 200 : 503).json({ ok, checks });
    });

    // Phase 7: queue depth + job latency (observed directly from BullMQ) and
    // session-level latency (published by agent-worker over Redis pub/sub —
    // see services/metrics.js for why).
    observeQueueMetrics();
    const sessionMetricsSub = subscribeSessionMetrics();

    // Phase 7: relays agent-worker-observed usage (voice minutes, vision
    // frames, estimated cost) into the real Phase 6 billing ledger — see
    // services/usage-bridge.js for why this can't call recordUsage() directly.
    const usageEventsSub = subscribeUsageEvents();

    registerRoutes(app);

    // Global error handler — tüm yakalanmamış hataları yakalar
    app.use(errorHandler);

    const server = http.createServer(app);
    const realtime = createRealtimeServer(server);
    app.set('io', realtime.io);

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
            realtime.io.emit(event, payload);
        } catch { /* malformed — ignore */ }
    });

    // Phase 7: graceful shutdown — drain in-flight HTTP/Socket.IO connections,
    // then close every resource this process opened, concurrently.
    registerGracefulShutdown({
        server,
        realtime,
        tasks: [
            { name: 'mongodb', fn: disconnectDB },
            { name: 'redis-sub', fn: () => redisSub.quit() },
            { name: 'queue-redis', fn: () => queueConnection.quit() },
            { name: 'queue-metrics', fn: closeQueueMetrics },
            { name: 'session-metrics-sub', fn: () => sessionMetricsSub.quit() },
            { name: 'usage-events-sub', fn: () => usageEventsSub.quit() },
            { name: 'otel-tracing', fn: shutdownTracing }
        ]
    });
}

main().catch((err) => {
    console.error('API failed to start details:', err);
    Logger.error('API failed to start', { error: err?.message });
    process.exit(1);
});

