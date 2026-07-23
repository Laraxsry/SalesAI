import crypto from 'crypto';
import { Workspace, Lead, Session } from '@repo/database';
import { Logger } from '@repo/logger';
import { DeadLetterJob } from '@repo/database';

const log = Logger.child({ module: 'dispatch-webhooks' });

/** Supported event names that can trigger webhook delivery. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Computes the HMAC-SHA256 signature for a webhook payload.
 * Recipients verify this header to ensure the request is authentic.
 *
 * @param {string} secret
 * @param {string} body - JSON string of the payload
 * @returns {string} — e.g. "sha256=abc123..."
 */
function sign(secret, body) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Delivers a single webhook payload to one URL.
 * Returns { ok: true } on 2xx, { ok: false, status, body } otherwise.
 *
 * @param {{ url: string, secret: string }} endpoint
 * @param {object} payload
 */
async function deliverOne(endpoint, payload) {
    const body = JSON.stringify(payload);
    const signature = sign(endpoint.secret, body);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
        const res = await fetch(endpoint.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-SalesAI-Signature': signature,
                'X-SalesAI-Event': payload.event,
                'User-Agent': 'SalesAI-Webhooks/1.0'
            },
            body,
            signal: controller.signal
        });
        clearTimeout(timer);
        if (res.ok) return { ok: true };
        const text = await res.text().catch(() => '');
        return { ok: false, status: res.status, body: text };
    } catch (err) {
        clearTimeout(timer);
        return { ok: false, error: err.message };
    }
}

/**
 * Delivers a webhook with exponential backoff retry.
 * Retries: 1 s → 5 s → 15 s (3 attempts total).
 *
 * @param {{ url: string, secret: string }} endpoint
 * @param {object} payload
 */
async function deliverWithRetry(endpoint, payload) {
    const delays = [1_000, 5_000, 15_000];
    let lastResult;
    for (let attempt = 0; attempt < delays.length; attempt++) {
        lastResult = await deliverOne(endpoint, payload);
        if (lastResult.ok) {
            log.info('webhook delivered', { url: endpoint.url, attempt: attempt + 1 });
            return lastResult;
        }
        log.warn('webhook delivery failed, retrying', {
            url: endpoint.url,
            attempt: attempt + 1,
            result: lastResult
        });
        if (attempt < delays.length - 1) {
            await new Promise(res => setTimeout(res, delays[attempt]));
        }
    }
    return lastResult;
}

/**
 * Builds the webhook payload for a given event type.
 *
 * @param {string} event
 * @param {{ lead?: object, session?: object }} data
 */
function buildPayload(event, data) {
    const base = {
        event,
        timestamp: new Date().toISOString(),
        apiVersion: '2026-07'
    };

    if (data.lead) {
        const l = data.lead;
        base.lead = {
            id: String(l._id),
            score: l.score,
            status: l.status,
            contact: l.contact,
            signals: (l.signals || []).map(s => s.type || s),
            sessionId: String(l.sessionId),
            agentId: String(l.agentId),
            createdAt: l.createdAt
        };
    }

    if (data.session) {
        const s = data.session;
        base.session = {
            id: String(s._id),
            agentId: String(s.agentId),
            visitorName: s.visitorName,
            status: s.status,
            startedAt: s.startedAt,
            endedAt: s.endedAt
        };
    }

    return base;
}

/**
 * dispatch-webhooks job handler.
 *
 * Loads the workspace's active webhooks, filters by event, and delivers the
 * payload to each URL. Failures are retried (3x) then written to DeadLetterJob.
 *
 * @param {{ event: string, leadId?: string, sessionId?: string, workspaceId: string }} params
 */
export async function dispatchWebhooks({ event, leadId, sessionId, workspaceId }) {
    // 1. Load workspace and its webhooks
    const workspace = await Workspace.findById(workspaceId).lean();
    if (!workspace) {
        log.warn('dispatch-webhooks: workspace not found', { workspaceId });
        return;
    }

    const activeHooks = (workspace.webhooks || []).filter(wh => {
        if (!wh.active) return false;
        // Empty events array means "subscribe to all"
        if (!wh.events || wh.events.length === 0) return true;
        return wh.events.includes(event);
    });

    if (activeHooks.length === 0) {
        log.debug('dispatch-webhooks: no matching active webhooks', { event, workspaceId });
        return;
    }

    // 2. Build payload data
    const data = {};
    if (leadId) {
        data.lead = await Lead.findById(leadId).lean();
    }
    if (sessionId) {
        data.session = await Session.findById(sessionId).lean();
    }

    const payload = buildPayload(event, data);

    // 3. Deliver to each matching webhook
    await Promise.allSettled(
        activeHooks.map(async (wh) => {
            const result = await deliverWithRetry({ url: wh.url, secret: wh.secret }, payload);
            if (!result.ok) {
                // Write to dead-letter queue for later inspection
                await DeadLetterJob.create({
                    queue: 'dispatch-webhooks',
                    job: { event, leadId, sessionId, workspaceId },
                    error: JSON.stringify(result),
                    failedAt: new Date()
                }).catch(e => log.warn('dead-letter write failed', { error: e.message }));
                log.error('webhook permanently failed, written to dead-letter', {
                    url: wh.url,
                    event,
                    result
                });
            }
        })
    );
}
