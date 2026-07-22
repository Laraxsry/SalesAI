import { Schema, model } from 'mongoose';

/**
 * AuditLog — İmmutable privileged action kaydı.
 *
 * Neden gerekli?
 * Kim ne zaman ne yaptı? Yasal uyumluluk (GDPR, SOC2) ve iç güvenlik denetimleri
 * için immutable bir kayıt şarttır. Mevcut sistemde bu takip mekanizması yok.
 *
 * Immutability garantisi:
 * - Schema üzerinde herhangi bir index tanımlanmaz (sadece okuma için index'ler var).
 * - Uygulama katmanında `logAudit()` helper SADECE insertOne kullanır; update/delete hiç yok.
 * - `Object.freeze` ile action enum export'u da yanlışlıkla eklemeyi önler.
 *
 * `actorType`: Eylemi yapan user mı yoksa API key mi olduğunu ayırt eder.
 * `target`: Hangi kaynak etkilendi (örn. { type: 'Agent', id: '...' }).
 * `before/after`: Değişiklik öncesi/sonrası değerler (role-change, status-change için).
 */

export const AUDIT_ACTIONS = Object.freeze({
    // Auth
    AUTH_LOGIN: 'auth.login',
    AUTH_LOGOUT: 'auth.logout',
    AUTH_REFRESH_REUSE: 'auth.refresh_reuse',
    AUTH_2FA_ENABLED: 'auth.2fa_enabled',
    AUTH_2FA_DISABLED: 'auth.2fa_disabled',
    AUTH_LOCKOUT: 'auth.lockout',
    // Member management
    MEMBER_INVITED: 'member.invited',
    MEMBER_ROLE_CHANGED: 'member.role_changed',
    MEMBER_REMOVED: 'member.removed',
    // Agent lifecycle
    AGENT_ACTIVATED: 'agent.activated',
    AGENT_PAUSED: 'agent.paused',
    AGENT_DELETED: 'agent.deleted',
    // API keys
    APIKEY_CREATED: 'apikey.created',
    APIKEY_REVOKED: 'apikey.revoked',
    // Privacy / GDPR
    PRIVACY_EXPORT: 'privacy.export',
    PRIVACY_DELETE: 'privacy.delete',
    // Data maintenance
    DATA_PURGE: 'data.purge',
    // Billing
    BILLING_PLAN_CHANGED: 'billing.plan_changed'
});

const AuditLogSchema = new Schema(
    {
        workspaceId: {
            type: Schema.Types.ObjectId,
            ref: 'Workspace',
            required: true,
            index: true
        },
        actorId: {
            type: Schema.Types.ObjectId,
            required: true,
            comment: 'userId veya apiKeyId'
        },
        actorType: {
            type: String,
            enum: ['user', 'api-key'],
            default: 'user'
        },
        action: {
            type: String,
            required: true,
            enum: Object.values(AUDIT_ACTIONS),
            index: true
        },
        target: {
            type: {
                type: String, // 'Agent', 'Member', 'Session', vb.
                required: true
            },
            id: { type: String }
        },
        before: { type: Schema.Types.Mixed }, // Değişiklik öncesi snapshot
        after: { type: Schema.Types.Mixed },  // Değişiklik sonrası snapshot
        ip: { type: String },
        userAgent: { type: String },
        at: { type: Date, default: Date.now, index: true }
    },
    {
        timestamps: false,     // `at` alanını kendimiz yönetiyoruz
        strict: true,
        // Mongoose hooks'larını devre dışı bırakmak için:
        // update/delete işlemlerini uygulama katmanında yasak tutacağız
    }
);

// Composite index: workspace + zaman aralığı sorgusu için
AuditLogSchema.index({ workspaceId: 1, at: -1 });
// Action filtreleme için
AuditLogSchema.index({ workspaceId: 1, action: 1, at: -1 });

export const AuditLog = model('AuditLog', AuditLogSchema);
