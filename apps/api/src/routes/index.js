import { authRouter } from './auth.js';
import { workspacesRouter } from './workspaces.js';
import { productsRouter } from './products.js';
import { sessionsRouter } from './sessions.js';
import { knowledgeRouter } from './knowledge.js';
import { agentsRouter } from './agents.js';
import { analyticsRouter } from './analytics.js';
// Phase 5: Embeddable SDK & Widget
import { embedRouter } from './embed.js';
import { sdkRouter } from './sdk.js';

// Phase 8: Security, Compliance & Scale
import { apiKeysRouter } from './api-keys.js';
import { auditLogsRouter } from './audit-logs.js';
import { privacyRouter } from './privacy.js';

// Phase 6: Team, Billing & Quotas
import { invitationsRouter } from './invitations.js';
import { membershipsRouter } from './memberships.js';
import { billingRouter } from './billing.js';

// Phase 4: Webhook / CRM Integrations
import { integrationsRouter } from './integrations.js';

/** Mounts all API routers under /api/v1. */
export function registerRoutes(app) {
    // Phase 0: Foundation
    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/workspaces', workspacesRouter);
    app.use('/api/v1/products', productsRouter);

    // Phase 6: Team, Billing & Quotas
    app.use('/api/v1/invitations', invitationsRouter);
    app.use('/api/v1/memberships', membershipsRouter);
    app.use('/api/v1/billing', billingRouter);

    // Phase 1+: Knowledge, Agents, Sessions
    app.use('/api/v1/sessions', sessionsRouter);
    app.use('/api/v1/knowledge', knowledgeRouter);
    app.use('/api/v1/agents', agentsRouter);
    app.use('/api/v1/analytics', analyticsRouter);

    // Phase 5: Embeddable SDK & Widget — public, origin-checked
    app.use('/api/v1/embed', embedRouter);
    // Bare (unversioned) path, matching md/backend/phase5's literal route.
    app.use('/sdk', sdkRouter);

    // Phase 8: Security, Compliance & Scale
    app.use('/api/v1/api-keys', apiKeysRouter);
    app.use('/api/v1/audit-logs', auditLogsRouter);
    app.use('/api/v1/privacy', privacyRouter);

    // Phase 4: Webhook / CRM Integrations
    app.use('/api/v1/integrations', integrationsRouter);
}

