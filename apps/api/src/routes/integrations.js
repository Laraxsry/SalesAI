/**
 * Phase 4 — Webhook / CRM Integration Routes
 *
 * Allows workspace admins to register outbound webhook endpoints that receive
 * real-time payloads (lead.captured, session.started, etc.) signed with
 * HMAC-SHA256 for authenticity verification.
 *
 * All routes are workspace-scoped and require authentication.
 *
 * Routes:
 *   POST   /integrations/webhooks           — register a new webhook
 *   GET    /integrations/webhooks           — list workspace webhooks
 *   PATCH  /integrations/webhooks/:hookId   — update (toggle active, change URL/events)
 *   DELETE /integrations/webhooks/:hookId   — remove
 *   POST   /integrations/webhooks/:hookId/test — send a test payload now
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { Workspace } from '@repo/database';
import { requireAuth } from '@repo/auth';
import { validate } from '@repo/validation';
import { WebhookInput } from '@repo/contracts';
import { resolveTenant, resolveMember } from '../middleware/tenant.js';

export const integrationsRouter = Router();

// ── Helper: load workspace or 404 ─────────────────────────────────────────
async function getWorkspace(req, res) {
    const ws = await Workspace.findById(req.workspaceId);
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return null; }
    return ws;
}

// ── POST /integrations/webhooks ────────────────────────────────────────────
/**
 * Register a new outbound webhook for the workspace.
 *
 * Body: { url, secret?, events?, active? }
 *
 * Returns the newly created webhook entry (with its generated _id and secret).
 */
integrationsRouter.post(
    '/webhooks',
    requireAuth,
    resolveTenant,
    resolveMember,
    validate({ body: WebhookInput }),
    async (req, res, next) => {
        try {
            const ws = await getWorkspace(req, res);
            if (!ws) return;

            const { url, secret, events, active } = req.body;

            // Optionally override the auto-generated secret with user's own value
            const hookSecret = secret || crypto.randomBytes(24).toString('hex');

            ws.webhooks.push({ url, secret: hookSecret, events: events || [], active: active ?? true });
            await ws.save();

            // Return the newly added hook (last element)
            const created = ws.webhooks[ws.webhooks.length - 1];
            res.status(201).json(created);
        } catch (err) {
            next(err);
        }
    }
);

// ── GET /integrations/webhooks ─────────────────────────────────────────────
/** List all webhooks for the workspace (secrets are masked for security). */
integrationsRouter.get(
    '/webhooks',
    requireAuth,
    resolveTenant,
    resolveMember,
    async (req, res, next) => {
        try {
            const ws = await getWorkspace(req, res);
            if (!ws) return;

            // Mask secret: show only first 8 chars
            const hooks = ws.webhooks.map(wh => ({
                _id: wh._id,
                url: wh.url,
                secret: wh.secret.slice(0, 8) + '••••••••',
                events: wh.events,
                active: wh.active
            }));

            res.json(hooks);
        } catch (err) {
            next(err);
        }
    }
);

// ── PATCH /integrations/webhooks/:hookId ───────────────────────────────────
/** Update an existing webhook (toggle active, change url/events/secret). */
integrationsRouter.patch(
    '/webhooks/:hookId',
    requireAuth,
    resolveTenant,
    resolveMember,
    async (req, res, next) => {
        try {
            const ws = await getWorkspace(req, res);
            if (!ws) return;

            const hook = ws.webhooks.id(req.params.hookId);
            if (!hook) return res.status(404).json({ error: 'Webhook not found' });

            const { url, secret, events, active } = req.body;
            if (url !== undefined)    hook.url    = url;
            if (secret !== undefined) hook.secret = secret;
            if (events !== undefined) hook.events = events;
            if (active !== undefined) hook.active = active;

            await ws.save();
            res.json({ _id: hook._id, url: hook.url, events: hook.events, active: hook.active });
        } catch (err) {
            next(err);
        }
    }
);

// ── DELETE /integrations/webhooks/:hookId ──────────────────────────────────
/** Remove a webhook endpoint. */
integrationsRouter.delete(
    '/webhooks/:hookId',
    requireAuth,
    resolveTenant,
    resolveMember,
    async (req, res, next) => {
        try {
            const ws = await getWorkspace(req, res);
            if (!ws) return;

            const hook = ws.webhooks.id(req.params.hookId);
            if (!hook) return res.status(404).json({ error: 'Webhook not found' });

            hook.deleteOne();
            await ws.save();
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    }
);

// ── POST /integrations/webhooks/:hookId/test ───────────────────────────────
/**
 * Deliver a sample payload to the webhook URL right now.
 * Useful for verifying connectivity without waiting for a real lead event.
 */
integrationsRouter.post(
    '/webhooks/:hookId/test',
    requireAuth,
    resolveTenant,
    resolveMember,
    async (req, res, next) => {
        try {
            const ws = await getWorkspace(req, res);
            if (!ws) return;

            const hook = ws.webhooks.id(req.params.hookId);
            if (!hook) return res.status(404).json({ error: 'Webhook not found' });

            const payload = {
                event: 'test',
                timestamp: new Date().toISOString(),
                apiVersion: '2026-07',
                message: 'This is a test payload from SalesAI. Your webhook endpoint is working correctly!'
            };

            const body = JSON.stringify(payload);
            const signature = 'sha256=' + crypto
                .createHmac('sha256', hook.secret)
                .update(body)
                .digest('hex');

            let deliveryResult;
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 10_000);
                const httpRes = await fetch(hook.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-SalesAI-Signature': signature,
                        'X-SalesAI-Event': 'test',
                        'User-Agent': 'SalesAI-Webhooks/1.0'
                    },
                    body,
                    signal: ctrl.signal
                });
                clearTimeout(timer);
                deliveryResult = { ok: httpRes.ok, status: httpRes.status };
            } catch (err) {
                deliveryResult = { ok: false, error: err.message };
            }

            res.json({ payload, delivery: deliveryResult });
        } catch (err) {
            next(err);
        }
    }
);
