import { sessionsRouter } from './sessions.js';
import { knowledgeRouter } from './knowledge.js';
import { agentsRouter } from './agents.js';

/** Mounts all API routers under /api/v1. */
export function registerRoutes(app) {
    app.use('/api/v1/sessions', sessionsRouter);
    app.use('/api/v1/knowledge', knowledgeRouter);
    app.use('/api/v1/agents', agentsRouter);
}
