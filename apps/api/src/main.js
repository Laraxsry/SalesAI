import '@repo/config-env/load';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
    app.use(cors({
        origin: (origin, callback) => {
            const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').filter(Boolean);
            // Dev ortamında origin'siz isteklere izin ver (Postman, curl)
            if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
                return callback(null, true);
            }
            callback(new Error(`CORS: Origin ${origin} not allowed`));
        },
        credentials: true
    }));

    app.use(express.json({ limit: '5mb' }));

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
    console.error('API failed to start details:', err);
    Logger.error('API failed to start', { error: err?.message });
    process.exit(1);
});

