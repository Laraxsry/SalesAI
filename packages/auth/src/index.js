import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const ACCESS_SECRET = () => process.env.JWT_SECRET || 'dev-access';
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || 'dev-refresh';
const ACCESS_TTL = () => Number(process.env.JWT_ACCESS_EXPIRES_IN || 900);
const REFRESH_TTL = () => Number(process.env.JWT_REFRESH_EXPIRES_IN || 604800);

export async function hashPassword(plain) {
    return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}

/**
 * Access + Refresh token çifti üretir.
 * Phase 8: artık refreshTokenFamily'yi de döndürür (AuthSession'da saklanır).
 */
export function signTokens(payload) {
    const accessToken = jwt.sign(payload, ACCESS_SECRET(), { expiresIn: ACCESS_TTL() });
    const refreshToken = jwt.sign(payload, REFRESH_SECRET(), { expiresIn: REFRESH_TTL() });
    return { accessToken, refreshToken };
}

export function verifyAccess(token) {
    return jwt.verify(token, ACCESS_SECRET());
}

export function verifyRefresh(token) {
    return jwt.verify(token, REFRESH_SECRET());
}

/**
 * Refresh token'ın SHA-256 hash'ini üretir.
 * AuthSession'da düz token yerine hash saklanır (güvenlik için).
 */
export function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * API key üretir: "sk_" prefix'li 32 byte hex string.
 * Dönen değer: { plainKey, keyHash, prefix }
 * - plainKey: kullanıcıya BİR KEZ gösterilir
 * - keyHash: DB'ye yazılır (SHA-256)
 * - prefix: listeleme/görüntüleme için (ilk 12 karakter)
 */
export function generateApiKey() {
    const raw = crypto.randomBytes(32).toString('hex');
    const plainKey = `sk_${raw}`;
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');
    const prefix = plainKey.slice(0, 12) + '...';
    return { plainKey, keyHash, prefix };
}

/**
 * Gelen Bearer token'ı hash'leyip ApiKey olup olmadığını kontrol etmek için
 * kullanılan hash hesaplama fonksiyonu.
 */
export function hashApiKey(plainKey) {
    return crypto.createHash('sha256').update(plainKey).digest('hex');
}

/**
 * Express middleware: Bearer token'dan auth yapar.
 *
 * Phase 8 güncellemesi:
 * 1. Token "sk_" ile başlıyorsa → API key auth (DB'den keyHash lookup)
 * 2. Diğer durumlarda → JWT access token
 *
 * API key auth için ApiKey modelini lazy import eder (circular dep önlemek için).
 */
export function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // API key mi, JWT mi?
    if (token.startsWith('sk_')) {
        return _handleApiKeyAuth(token, req, res, next);
    }

    // JWT access token
    try {
        req.user = verifyAccess(token);
        req.authType = 'jwt';
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}

async function _handleApiKeyAuth(token, req, res, next) {
    try {
        const { ApiKey } = await import('@repo/database');
        const keyHash = hashApiKey(token);
        const apiKey = await ApiKey.findOne({ keyHash, revokedAt: null });
        if (!apiKey) return res.status(401).json({ error: 'Invalid or revoked API key' });

        // Kullanım zamanını güncelle (fire-and-forget)
        ApiKey.updateOne({ _id: apiKey._id }, { lastUsedAt: new Date() }).catch(() => {});

        // req.user benzeri bir yapı kur: workspaceId ve scopes bilgisini ekle
        req.user = { sub: null, apiKeyId: String(apiKey._id), workspaceId: String(apiKey.workspaceId) };
        req.apiKey = apiKey;
        req.authType = 'api-key';
        next();
    } catch (err) {
        next(err);
    }
}
