import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

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

/** Express middleware that authenticates a Bearer access token. */
export function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = verifyAccess(token);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}
