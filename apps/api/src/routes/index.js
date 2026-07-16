import { authRouter } from './auth.js';
import { workspacesRouter } from './workspaces.js';
import { productsRouter } from './products.js';
import { sessionsRouter } from './sessions.js';
import { knowledgeRouter } from './knowledge.js';
import { agentsRouter } from './agents.js';
import { analyticsRouter } from './analytics.js';

/** Mounts all API routers under /api/v1. */
export function registerRoutes(app) {
    // Phase 0: Foundation
    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/workspaces', workspacesRouter);
    app.use('/api/v1/products', productsRouter);

    // Phase 1+: Knowledge, Agents, Sessions
    app.use('/api/v1/sessions', sessionsRouter);
    app.use('/api/v1/knowledge', knowledgeRouter);
    app.use('/api/v1/agents', agentsRouter);
    app.use('/api/v1/analytics', analyticsRouter);
}
