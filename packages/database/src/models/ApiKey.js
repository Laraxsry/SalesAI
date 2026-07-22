import { Schema, model } from 'mongoose';

/**
 * ApiKey — Scoped programmatic access keys.
 *
 * Neden gerekli?
 * CI/CD, mobil uygulama veya 3. parti entegrasyonlar JWT refresh döngüsüne
 * girmeden API'ya erişmeli. API key'ler bu ihtiyacı karşılar.
 *
 * Güvenlik prensipleri:
 * - Key yalnızca oluşturulduğu an plain-text gösterilir, sonra hash'i saklanır.
 * - `prefix` alanı: ilk 8 karakter (ör. "sk_abc123_") hangi key olduğunu
 *   gösteri/listeleme için kullanılır; hash ifşa edilmez.
 * - SHA-256 hash: bcrypt değil; API key'ler yüksek entropili rastgele stringlerdir,
 *   dictionary attack riski yoktur, bu nedenle SHA-256 yeterlidir ve daha hızlıdır.
 * - `scopes[]`: read | write | analytics:read gibi granüler izinler.
 * - `revokedAt`: null ise aktif, dolu ise iptal edilmiş.
 */
const ApiKeySchema = new Schema(
    {
        workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
        name: { type: String, required: true },
        keyHash: {
            type: String,
            required: true,
            comment: 'SHA-256 hash — plain-text key sadece oluşturulduğunda döner'
        },
        prefix: {
            type: String,
            required: true,
            comment: 'Key\'in ilk 8 karakteri; listeleme/görüntülemede gösterilir'
        },
        scopes: {
            type: [String],
            default: ['read'],
            comment: 'Örn: ["read", "write", "analytics:read"]'
        },
        lastUsedAt: { type: Date, default: null },
        revokedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

// Hızlı lookup: her gelen istekte Bearer token → hash → bu index üzerinden bulunur
ApiKeySchema.index({ keyHash: 1 });

export const ApiKey = model('ApiKey', ApiKeySchema);
