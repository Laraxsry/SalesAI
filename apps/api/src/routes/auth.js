import { Router } from 'express';
import { validate } from '@repo/validation';
import { RegisterInput, LoginInput } from '@repo/contracts';
import { User, Workspace, Membership } from '@repo/database';
import {
    hashPassword,
    verifyPassword,
    signTokens,
    verifyRefresh,
    requireAuth
} from '@repo/auth';
import { shortId } from '@repo/utils';

export const authRouter = Router();

/**
 * POST /auth/register
 *
 * Yeni kullanıcı kaydı. Ne yapar:
 * 1. Şifreyi bcrypt ile hash'ler (güvenli saklamak için)
 * 2. User dokümanı oluşturur (MongoDB'ye kaydeder)
 * 3. Otomatik bir "kişisel workspace" oluşturur (her ürün bir workspace'e ait olmalı)
 * 4. Kullanıcıyı o workspace'e OWNER rolüyle ekler (Membership)
 * 5. JWT access + refresh token döner
 */
authRouter.post('/register', validate({ body: RegisterInput }), async (req, res, next) => {
    try {
        const { email, password, name } = req.body;

        // Aynı email ile kayıtlı kullanıcı var mı kontrol et
        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Şifreyi hash'le — düz metin olarak saklamak güvenlik açığıdır
        const passwordHash = await hashPassword(password);

        // Kullanıcıyı oluştur
        const user = await User.create({ email, passwordHash, name });

        // Her kullanıcıya otomatik kişisel workspace oluştur.
        // "slug" URL-friendly benzersiz bir tanımlayıcıdır.
        const workspace = await Workspace.create({
            name: `${name}'s Workspace`,
            slug: `ws-${shortId(8)}`,
            ownerId: user._id
        });

        // Kullanıcıyı workspace'e OWNER olarak ata
        await Membership.create({
            workspaceId: workspace._id,
            userId: user._id,
            role: 'OWNER'
        });

        // JWT token'ları oluştur — bunlar istemcinin kimliğini kanıtlar
        const tokens = signTokens({ sub: String(user._id), email: user.email });

        res.status(201).json({
            user: { id: String(user._id), email: user.email, name: user.name },
            workspace: { id: String(workspace._id), name: workspace.name, slug: workspace.slug },
            ...tokens
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /auth/login
 *
 * Giriş yapar. Email + şifre doğrularsa JWT token'ları döner.
 * verifyPassword() bcrypt ile hash'lenmiş şifreyi karşılaştırır —
 * böylece veritabanında düz metin şifre saklanmaz.
 */
authRouter.post('/login', validate({ body: LoginInput }), async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const tokens = signTokens({ sub: String(user._id), email: user.email });

        res.json({
            user: { id: String(user._id), email: user.email, name: user.name },
            ...tokens
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /auth/refresh
 *
 * Access token'ın süresi dolduğunda (15 dk), refresh token ile yenisini alırsın.
 * Refresh token daha uzun yaşar (7 gün). Böylece kullanıcı sürekli giriş yapmak zorunda kalmaz.
 *
 * Body: { "refreshToken": "..." }
 */
authRouter.post('/refresh', async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'refreshToken is required' });
        }

        // Refresh token'ı doğrula — süresi dolmuşsa veya geçersizse hata verir
        const payload = verifyRefresh(refreshToken);

        // Kullanıcının hala var olduğunu kontrol et (hesap silinmiş olabilir)
        const user = await User.findById(payload.sub);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Yeni token çifti oluştur
        const tokens = signTokens({ sub: String(user._id), email: user.email });
        res.json(tokens);
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }
        next(err);
    }
});

/**
 * POST /auth/logout
 *
 * Sunucu tarafında özel bir işlem yapılmaz (JWT stateless'tır).
 * İstemci access + refresh token'ları silmeli.
 * İleride token blacklisting (Redis'te) eklenebilir.
 */
authRouter.post('/logout', requireAuth, (_req, res) => {
    res.json({ message: 'Logged out' });
});
