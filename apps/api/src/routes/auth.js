import { Router } from 'express';
import { validate } from '@repo/validation';
import { RegisterInput, LoginInput } from '@repo/contracts';
import { User, Workspace, Membership, AuthSession } from '@repo/database';
import {
    hashPassword,
    verifyPassword,
    signTokens,
    verifyRefresh,
    requireAuth,
    hashRefreshToken,
    generateApiKey
} from '@repo/auth';
import { shortId } from '@repo/utils';
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from '@repo/utils';
import IORedis from 'ioredis';
import { nanoid } from 'nanoid';

export const authRouter = Router();

// ─── Redis client (rate limiting için) ─────────────────────────────────────
// Lazy singleton — main.js'teki redis ile ayrı connection
let _redis = null;
function getRedis() {
    if (!_redis) {
        _redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
            lazyConnect: true
        });
        _redis.on('error', () => {}); // Sessiz hata — rate limit devre dışı kalır
    }
    return _redis;
}

// ─── Rate limiting helpers ──────────────────────────────────────────────────
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60; // 15 dakika

async function checkLoginRateLimit(email) {
    try {
        const redis = getRedis();
        const key = `login_attempts:${email.toLowerCase()}`;
        const count = await redis.incr(key);
        if (count === 1) {
            await redis.expire(key, LOGIN_LOCKOUT_SECONDS);
        }
        return count;
    } catch {
        return 0; // Redis hatasında rate limit'i bypass et
    }
}

async function resetLoginAttempts(email) {
    try {
        const redis = getRedis();
        await redis.del(`login_attempts:${email.toLowerCase()}`);
    } catch { /* ignore */ }
}

async function getRemainingLockoutSeconds(email) {
    try {
        const redis = getRedis();
        return await redis.ttl(`login_attempts:${email.toLowerCase()}`);
    } catch {
        return 0;
    }
}

// ─── POST /auth/register ────────────────────────────────────────────────────
/**
 * Yeni kullanıcı kaydı.
 * 1. Şifreyi bcrypt ile hash'ler
 * 2. User + kişisel workspace + OWNER membership oluşturur
 * 3. JWT token çifti döner
 */
authRouter.post('/register', validate({ body: RegisterInput }), async (req, res, next) => {
    try {
        const { email, password, name } = req.body;

        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const passwordHash = await hashPassword(password);
        const user = await User.create({ email, passwordHash, name });

        const workspace = await Workspace.create({
            name: `${name}'s Workspace`,
            slug: `ws-${shortId(8)}`,
            ownerId: user._id
        });

        await Membership.create({
            workspaceId: workspace._id,
            userId: user._id,
            role: 'OWNER'
        });

        const tokens = signTokens({ sub: String(user._id), email: user.email });

        // Phase 8: AuthSession oluştur (server-side session)
        const family = nanoid(32); // Bu login zincirinin ailesi
        await AuthSession.create({
            userId: user._id,
            refreshTokenHash: hashRefreshToken(tokens.refreshToken),
            family,
            device: req.headers['user-agent'] || 'unknown',
            ip: req.ip || req.socket?.remoteAddress,
            expiresAt: new Date(Date.now() + Number(process.env.JWT_REFRESH_EXPIRES_IN || 604800) * 1000)
        });

        res.status(201).json({
            user: { id: String(user._id), email: user.email, name: user.name },
            workspace: { id: String(workspace._id), name: workspace.name, slug: workspace.slug },
            ...tokens
        });
    } catch (err) {
        next(err);
    }
});

// ─── POST /auth/login ───────────────────────────────────────────────────────
/**
 * Giriş yapar.
 * Phase 8: Rate limiting (5 başarısız → 15 dk lockout) + AuthSession + AuditLog.
 * 2FA aktif kullanıcılarda mfaToken döner; tam token için /auth/2fa/verify gerekir.
 */
authRouter.post('/login', validate({ body: LoginInput }), async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const { ip, userAgent } = extractRequestMeta(req);

        // Lockout kontrolü
        const attempts = await checkLoginRateLimit(email);
        if (attempts > LOGIN_MAX_ATTEMPTS) {
            const ttl = await getRemainingLockoutSeconds(email);
            return res.status(429).json({
                error: 'Too many login attempts. Try again later.',
                retryAfterSeconds: ttl > 0 ? ttl : LOGIN_LOCKOUT_SECONDS
            });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
            // Başarısız deneme — attempts zaten artırıldı
            if (attempts >= LOGIN_MAX_ATTEMPTS) {
                // Lockout eşiğine ulaştık — AuditLog'a yaz
                // Workspace bul (kullanıcının ilk workspace'i)
                const membership = await Membership.findOne({ userId: user._id });
                if (membership) {
                    await logAudit({
                        action: AUDIT_ACTIONS.AUTH_LOCKOUT,
                        workspaceId: membership.workspaceId,
                        actorId: user._id,
                        target: { type: 'User', id: String(user._id) },
                        ip,
                        userAgent
                    });
                }
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Başarılı giriş — attempts sıfırla
        await resetLoginAttempts(email);

        // 2FA kontrolü
        if (user.twoFactorEnabled) {
            // Kısa süreli MFA token döner — tam erişim için /auth/2fa/verify gerekli
            const { authenticator } = await import('otplib');
            const mfaToken = signTokens({ sub: String(user._id), email: user.email, mfa: 'pending' });
            return res.json({
                mfaRequired: true,
                mfaToken: mfaToken.accessToken, // Kısa süreli, sadece 2FA verify için
                user: { id: String(user._id), email: user.email }
            });
        }

        const tokens = signTokens({ sub: String(user._id), email: user.email });
        const family = nanoid(32);

        // Server-side session kaydet
        await AuthSession.create({
            userId: user._id,
            refreshTokenHash: hashRefreshToken(tokens.refreshToken),
            family,
            device: userAgent,
            ip,
            expiresAt: new Date(Date.now() + Number(process.env.JWT_REFRESH_EXPIRES_IN || 604800) * 1000)
        });

        // Audit log
        const membership = await Membership.findOne({ userId: user._id });
        if (membership) {
            await logAudit({
                action: AUDIT_ACTIONS.AUTH_LOGIN,
                workspaceId: membership.workspaceId,
                actorId: user._id,
                target: { type: 'User', id: String(user._id) },
                ip,
                userAgent
            });
        }

        res.json({
            user: { id: String(user._id), email: user.email, name: user.name },
            ...tokens
        });
    } catch (err) {
        next(err);
    }
});

// ─── POST /auth/refresh ─────────────────────────────────────────────────────
/**
 * Refresh token rotation ile yeni token çifti döner.
 * Phase 8:
 * - Eski refreshTokenHash → AuthSession'dan bulunur
 * - Bulunamazsa: reuse saldırısı → tüm family iptal edilir
 * - Bulunursa: eski revoke edilir, yeni yazılır
 */
authRouter.post('/refresh', async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'refreshToken is required' });
        }

        let payload;
        try {
            payload = verifyRefresh(refreshToken);
        } catch {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        const tokenHash = hashRefreshToken(refreshToken);
        const session = await AuthSession.findOne({ refreshTokenHash: tokenHash });

        if (!session) {
            // REUSE DETECTED: bu hash daha önce rotate edilmiş demek → saldırı girişimi
            // Aynı family'deki tüm session'ları iptal et
            const revocationPayload = verifyRefresh(refreshToken).catch?.(() => payload);
            await AuthSession.updateMany(
                { userId: payload.sub },
                { revokedAt: new Date() }
            );

            // Audit log için workspace bul
            const membership = await Membership.findOne({ userId: payload.sub });
            if (membership) {
                await logAudit({
                    action: AUDIT_ACTIONS.AUTH_REFRESH_REUSE,
                    workspaceId: membership.workspaceId,
                    actorId: payload.sub,
                    target: { type: 'User', id: String(payload.sub) },
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                });
            }

            return res.status(401).json({ error: 'Token reuse detected. All sessions revoked.' });
        }

        if (session.revokedAt) {
            return res.status(401).json({ error: 'Refresh token has been revoked.' });
        }

        const user = await User.findById(session.userId);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Yeni token çifti üret
        const tokens = signTokens({ sub: String(user._id), email: user.email });

        // Eski session'ı revoke et, yeni hash yaz (rotation)
        await AuthSession.findByIdAndUpdate(session._id, {
            refreshTokenHash: hashRefreshToken(tokens.refreshToken),
            revokedAt: null, // Yeni hash geçerli
            expiresAt: new Date(Date.now() + Number(process.env.JWT_REFRESH_EXPIRES_IN || 604800) * 1000)
        });

        res.json(tokens);
    } catch (err) {
        next(err);
    }
});

// ─── POST /auth/logout ──────────────────────────────────────────────────────
/**
 * Phase 8: Aktif session'ı server tarafında revoke eder.
 * İstemci access + refresh token'ı silmeli; sunucu refresh hash'ini revoke eder.
 */
authRouter.post('/logout', requireAuth, async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        const { ip, userAgent } = extractRequestMeta(req);

        if (refreshToken) {
            const tokenHash = hashRefreshToken(refreshToken);
            await AuthSession.updateOne(
                { userId: req.user.sub, refreshTokenHash: tokenHash },
                { revokedAt: new Date() }
            );
        }

        // Audit log
        const membership = await Membership.findOne({ userId: req.user.sub });
        if (membership) {
            await logAudit({
                action: AUDIT_ACTIONS.AUTH_LOGOUT,
                workspaceId: membership.workspaceId,
                actorId: req.user.sub,
                target: { type: 'User', id: String(req.user.sub) },
                ip,
                userAgent
            });
        }

        res.json({ message: 'Logged out' });
    } catch (err) {
        next(err);
    }
});

// ─── POST /auth/2fa/enable ──────────────────────────────────────────────────
/**
 * Phase 8 Task 1.12: TOTP 2FA'yı etkinleştirme başlatır.
 * Secret üretir, QR code URI döner — kullanıcı Authenticator uygulamasına tarar.
 * 2FA henüz aktif değildir; /auth/2fa/verify ile doğrulanması gerekir.
 */
authRouter.post('/2fa/enable', requireAuth, async (req, res, next) => {
    try {
        const { generateSecret, generateURI } = await import('otplib');
        const user = await User.findById(req.user.sub);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.twoFactorEnabled) {
            return res.status(400).json({ error: '2FA is already enabled' });
        }

        const secret = generateSecret();
        const otpauthUrl = generateURI({ accountName: user.email, issuer: 'SalesAI', secret });

        // Secret'ı geçici olarak sakla (henüz enabled değil)
        await User.updateOne({ _id: user._id }, { twoFactorSecret: secret });

        res.json({
            secret,           // Kullanıcı manuel girişi için
            otpauthUrl,       // QR code üretmek için (frontend qrcode kütüphanesiyle render eder)
            message: 'Scan the QR code and verify with POST /auth/2fa/verify'
        });
    } catch (err) {
        next(err);
    }
});

// ─── POST /auth/2fa/verify ──────────────────────────────────────────────────
/**
 * Phase 8 Task 1.12: TOTP kodunu doğrular, 2FA'yı aktif eder.
 * Body: { token: "123456" }
 */
authRouter.post('/2fa/verify', requireAuth, async (req, res, next) => {
    try {
        const { verify } = await import('otplib');
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'token is required' });

        const user = await User.findById(req.user.sub);
        if (!user || !user.twoFactorSecret) {
            return res.status(400).json({ error: '2FA setup not started. Call /auth/2fa/enable first.' });
        }

        const result = await verify({ token, secret: user.twoFactorSecret });
        if (!result || !result.valid) return res.status(401).json({ error: 'Invalid TOTP token' });

        // 2FA aktif et + backup codes üret
        const backupCodes = Array.from({ length: 8 }, () => shortId(8));
        await User.updateOne({ _id: user._id }, {
            twoFactorEnabled: true,
            backupCodes // Gerçek üretimde hash'lenmeli; bu MVP için plain
        });

        // Audit log
        const membership = await Membership.findOne({ userId: user._id });
        if (membership) {
            const { ip, userAgent } = extractRequestMeta(req);
            await logAudit({
                action: AUDIT_ACTIONS.AUTH_2FA_ENABLED,
                workspaceId: membership.workspaceId,
                actorId: user._id,
                target: { type: 'User', id: String(user._id) },
                ip,
                userAgent
            });
        }

        res.json({
            ok: true,
            backupCodes, // SAKLA! Bir kez gösterilir.
            message: '2FA enabled. Save your backup codes securely.'
        });
    } catch (err) {
        next(err);
    }
});

// ─── POST /auth/2fa/disable ─────────────────────────────────────────────────
/**
 * Phase 8 Task 1.12: Şifre re-doğrulamasıyla 2FA'yı devre dışı bırakır.
 * Body: { password: "current_password" }
 */
authRouter.post('/2fa/disable', requireAuth, async (req, res, next) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'password is required' });

        const user = await User.findById(req.user.sub);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return res.status(401).json({ error: 'Invalid password' });

        await User.updateOne({ _id: user._id }, {
            twoFactorEnabled: false,
            twoFactorSecret: null,
            backupCodes: []
        });

        const membership = await Membership.findOne({ userId: user._id });
        if (membership) {
            const { ip, userAgent } = extractRequestMeta(req);
            await logAudit({
                action: AUDIT_ACTIONS.AUTH_2FA_DISABLED,
                workspaceId: membership.workspaceId,
                actorId: user._id,
                target: { type: 'User', id: String(user._id) },
                ip,
                userAgent
            });
        }

        res.json({ ok: true, message: '2FA disabled' });
    } catch (err) {
        next(err);
    }
});
