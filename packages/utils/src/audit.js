/**
 * Audit Logger Helper — Phase 8 Task 3.3
 *
 * Privileged action'ları AuditLog koleksiyonuna kaydeden merkezi helper.
 * Tüm kritik mutation'larda doğrudan AuditLog.create() yerine bu fonksiyon çağrılır.
 *
 * Neden helper?
 * - Format tutarlılığı: her action aynı şemaya göre yazılır
 * - Non-fatal: audit logging başarısız olsa bile iş mantığı durmamalı
 * - Test edilebilirlik: tek noktadan mock'lanabilir
 */

import { AuditLog, AUDIT_ACTIONS } from '@repo/database';
import { Logger } from '@repo/logger';

export { AUDIT_ACTIONS };

/**
 * Privileged bir action'ı AuditLog'a yazar.
 *
 * @param {object} params
 * @param {string} params.action           - AUDIT_ACTIONS enum değeri
 * @param {object} params.workspaceId      - Hangi workspace'te oldu
 * @param {object} params.actorId          - Kim yaptı (userId veya apiKeyId)
 * @param {string} [params.actorType]      - 'user' | 'api-key' (default: 'user')
 * @param {object} [params.target]         - { type: 'Agent', id: '...' }
 * @param {object} [params.before]         - Değişiklik öncesi snapshot
 * @param {object} [params.after]          - Değişiklik sonrası snapshot
 * @param {string} [params.ip]             - İstek IP adresi
 * @param {string} [params.userAgent]      - İstek User-Agent başlığı
 * @returns {Promise<void>}                - Non-fatal: hata loglanır, fırlatılmaz
 */
export async function logAudit({
    action,
    workspaceId,
    actorId,
    actorType = 'user',
    target,
    before,
    after,
    ip,
    userAgent
}) {
    try {
        await AuditLog.create({
            action,
            workspaceId,
            actorId,
            actorType,
            target,
            before,
            after,
            ip,
            userAgent,
            at: new Date()
        });
    } catch (err) {
        // Audit logging başarısız → iş mantığını durdurma, sadece logla
        Logger.error('[audit] AuditLog write failed', {
            action,
            workspaceId: String(workspaceId),
            error: err?.message
        });
    }
}

/**
 * Express request nesnesinden IP ve User-Agent çıkarır.
 * Proxy arkasında çalışırken X-Forwarded-For başlığını dikkate alır.
 *
 * @param {import('express').Request} req
 * @returns {{ ip: string, userAgent: string }}
 */
export function extractRequestMeta(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
        ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim())
        : req.socket?.remoteAddress || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return { ip, userAgent };
}
