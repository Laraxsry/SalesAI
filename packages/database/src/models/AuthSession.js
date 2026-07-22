import { Schema, model } from 'mongoose';

/**
 * AuthSession — Sunucu tarafında refresh token yönetimi.
 *
 * Neden gerekli?
 * Mevcut /auth/refresh endpoint'i stateless JWT ile çalışıyor: refresh token
 * çalınsa sunucu tarafında iptal etmek mümkün değil. Bu model:
 * - Her login'de yeni bir session oluşturur (refreshTokenHash saklar)
 * - Rotation sırasında eski hash revoke edilir, yeni hash yazılır
 * - Reuse detection: aynı token iki kez kullanılırsa tüm "family" iptal edilir
 * - Logout'ta `revokedAt` yazılır; requireAuth bunu kontrol eder
 *
 * `family`: Aynı login zincirinden türeyen tüm token'ları gruplar.
 * Reuse tespit edildiğinde family ile tüm session ailesi tek sorguda iptal edilir.
 */
const AuthSessionSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        refreshTokenHash: { type: String, required: true },
        family: {
            type: String,
            required: true,
            index: true,
            comment: 'Aynı login zincirinden türeyen tokenları gruplar; reuse tespitinde tüm aile iptal edilir'
        },
        device: { type: String }, // User-Agent başlığından alınır
        ip: { type: String },     // İstek IP'si
        revokedAt: { type: Date, default: null },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

// Süresi dolmuş ve revoke edilmiş session'ları otomatik temizlemek için TTL index.
// MongoDB bu kaydı expiresAt + 24 saat sonra siler (audit amaçlı kısa süre tutar).
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

export const AuthSession = model('AuthSession', AuthSessionSchema);
