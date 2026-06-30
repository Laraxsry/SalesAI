import '@repo/config-env/load';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Logger } from '@repo/logger';
import { connectDB } from '@repo/database';
import { createRealtimeServer } from '@repo/realtime';
import { registerRoutes } from './routes/index.js';

const PORT = Number(process.env.API_PORT || 5001);

async function main() {
    await connectDB();

    const app = express();
    app.use(helmet());
    app.use(cors({ origin: (process.env.CORS_ORIGIN || '').split(',').filter(Boolean) }));
    app.use(express.json({ limit: '5mb' }));

    app.get('/health', (_req, res) => res.json({ ok: true, service: 'api' }));
    registerRoutes(app);

    const server = http.createServer(app);
    const io = createRealtimeServer(server);
    app.set('io', io);

    server.listen(PORT, () => Logger.info(`API listening on :${PORT}`));
}

main().catch((err) => {
    Logger.error('API failed to start', { error: err });
    process.exit(1);
});
