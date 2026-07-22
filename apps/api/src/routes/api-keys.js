import { Router } from 'express';
import { ApiKey, Membership } from '@repo/database';
import { requireAuth, generateApiKey } from '@repo/auth';
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from '@repo/utils';
import { resolveTenant, resolveMember } from '../middleware/tenant.js';
import { requirePermission } from '@repo/access';

export const apiKeysRouter = Router();

/**
 * POST /api-keys
 * Yeni bir scoped API key oluşturur.
 *
 * Phase 8 Task 1.9
 * - Plain key SADECE bu response'ta döner — sonra hash'i saklanır
 * - `scopes` isteğe bağlı; varsayılan ["read"]
 * - Workspace'e üye olmak gerekir (OWNER veya ADMIN)
 *
 * Body: { workspaceId, name, scopes? }
 */
apiKeysRouter.post('/', requireAuth, resolveTenant, resolveMember, requirePermission('agent:update'), async (req, res, next) => {
    try {
        const { name, scopes = ['read'] } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });

        const { plainKey, keyHash, prefix } = generateApiKey();

        const apiKey = await ApiKey.create({
            workspaceId: req.workspaceId,
            name,
            keyHash,
            prefix,
            scopes
        });

        const { ip, userAgent } = extractRequestMeta(req);
        await logAudit({
            action: AUDIT_ACTIONS.APIKEY_CREATED,
            workspaceId: req.workspaceId,
            actorId: req.user.sub,
            target: { type: 'ApiKey', id: String(apiKey._id) },
            after: { name, scopes, prefix },
            ip,
            userAgent
        });

        // plainKey SADECE burada döner — sonra bir daha görülemez
        res.status(201).json({
            id: String(apiKey._id),
            name: apiKey.name,
            prefix: apiKey.prefix,
            scopes: apiKey.scopes,
            plainKey, // BU DEĞERİ SAKLA — bir daha gösterilmez
            createdAt: apiKey.createdAt
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api-keys
 * Workspace'e ait aktif API key'leri listeler.
 * plainKey hiçbir zaman döndürülmez; sadece prefix + metadata.
 */
apiKeysRouter.get('/', requireAuth, resolveTenant, resolveMember, async (req, res, next) => {
    try {
        const keys = await ApiKey.find({
            workspaceId: req.workspaceId,
            revokedAt: null
        }).select('-keyHash').sort({ createdAt: -1 }).lean();

        // Mongoose lean() returns _id, map to id for client consistency
        const serialized = keys.map(k => {
            const { _id, ...rest } = k;
            return { id: String(_id), ...rest };
        });

        res.json(serialized);
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api-keys/:id
 * API key'i revoke eder (soft delete — revokedAt yazılır).
 * Aktif isteklerde hemen geçersiz hale gelir (requireAuth her sorguda DB'ye bakar).
 */
apiKeysRouter.delete('/:id', requireAuth, resolveTenant, resolveMember, requirePermission('agent:update'), async (req, res, next) => {
    try {
        const apiKey = await ApiKey.findOne({
            _id: req.params.id,
            workspaceId: req.workspaceId,
            revokedAt: null
        });

        if (!apiKey) return res.status(404).json({ error: 'API key not found or already revoked' });

        await ApiKey.updateOne({ _id: apiKey._id }, { revokedAt: new Date() });

        const { ip, userAgent } = extractRequestMeta(req);
        await logAudit({
            action: AUDIT_ACTIONS.APIKEY_REVOKED,
            workspaceId: req.workspaceId,
            actorId: req.user.sub,
            target: { type: 'ApiKey', id: String(apiKey._id) },
            before: { name: apiKey.name, prefix: apiKey.prefix },
            ip,
            userAgent
        });

        res.json({ ok: true, id: String(apiKey._id), revoked: true });
    } catch (err) {
        next(err);
    }
});
