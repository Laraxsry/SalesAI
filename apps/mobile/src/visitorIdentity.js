import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from '../config';

const STORAGE_KEY = 'salesai:visitor-identity';

let cache = null;

async function load() {
    if (cache) return cache;
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        cache = raw ? JSON.parse(raw) : {};
    } catch {
        cache = {};
    }
    return cache;
}

async function persist(next) {
    cache = next;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/**
 * Lazily establishes the anonymous visitor identity (POST /api/v1/devices
 * with no push token yet) the first time it's needed — e.g. before starting
 * a session, so it can be tagged with `visitorId` and later listed by
 * GET /sessions/mine once the visitor syncs via magic-link.
 */
export async function getVisitorId() {
    const state = await load();
    if (state.visitorId) return state.visitorId;

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/v1/devices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!res.ok) return null;
        const data = await res.json();
        await persist({ ...state, visitorId: data.visitorId });
        return data.visitorId;
    } catch (err) {
        console.warn('Failed to establish visitor identity:', err?.message);
        return null;
    }
}

/** Registers a real Expo push token against the visitor established above. */
export async function registerPushToken(expoPushToken, platform) {
    const visitorId = await getVisitorId();
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/v1/devices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorId, expoPushToken, platform })
        });
        if (!res.ok) throw new Error('Failed to register device');
        return await res.json();
    } catch (err) {
        console.warn('Push token registration failed:', err?.message);
        return null;
    }
}

/** Step 1 of passwordless sync: request a magic link for `email`. */
export async function requestMagicLink(email) {
    const visitorId = await getVisitorId();
    const res = await fetch(`${CONFIG.API_URL}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, visitorId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to request magic link');
    return data;
}

/** Step 2: exchange the token from the link (deep link or pasted manually) for a visitor session. */
export async function verifyMagicLink(token) {
    const res = await fetch(`${CONFIG.API_URL}/api/v1/auth/magic-link/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Invalid or expired link');

    const state = await load();
    await persist({ ...state, visitorId: data.visitorId, email: data.email, accessToken: data.accessToken });
    return data;
}

/** Current visitor state: { visitorId, email?, accessToken? }. */
export async function getVisitorAuth() {
    return load();
}

/** Drops the synced email/session but keeps the local anonymous visitorId. */
export async function signOutVisitor() {
    const state = await load();
    await persist({ visitorId: state.visitorId });
}
