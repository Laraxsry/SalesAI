import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from '../config';
import { getVisitorAuth } from './visitorIdentity';

const STORAGE_KEY = 'salesai:saved-conversations';
const HIDDEN_REMOTE_KEY = 'salesai:hidden-remote-sessions';
const MAX_SAVED = 20;

async function getHiddenRemoteIds() {
    try {
        const raw = await AsyncStorage.getItem(HIDDEN_REMOTE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

/**
 * Saved conversations are local-first (works with zero setup, no account),
 * and — once the visitor has synced via magic-link (see visitorIdentity.js)
 * — merged with GET /sessions/mine so history follows them across devices.
 */
export async function saveConversation({ token, agentName, sessionId }) {
    if (!token) return;
    try {
        const existing = await getLocalConversations();
        const entry = {
            id: `${token}_${Date.now()}`,
            token,
            sessionId: sessionId || null,
            agentName: agentName || 'AI Temsilcisi',
            endedAt: new Date().toISOString()
        };
        const next = [entry, ...existing.filter((c) => c.token !== token)].slice(0, MAX_SAVED);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
        console.warn('Failed to save conversation locally:', err?.message);
    }
}

async function getLocalConversations() {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

/** Maps a `GET /sessions/mine` Session doc to the same shape as a local entry. */
function fromRemoteSession(session) {
    return {
        id: session._id,
        token: null,
        sessionId: session._id,
        agentName: session.agentName || 'AI Temsilcisi',
        endedAt: session.endedAt || session.startedAt,
        remote: true,
        status: session.status
    };
}

/**
 * Returns local conversations, plus remote ones from GET /sessions/mine when
 * the visitor has a synced session (falls back to local-only silently
 * otherwise — an anonymous visitor never calling this is expected, not an
 * error).
 */
export async function getSavedConversations() {
    const local = await getLocalConversations();

    const { accessToken } = await getVisitorAuth();
    if (!accessToken) return local;

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/v1/sessions/mine`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) return local;
        const remoteSessions = await res.json();

        const localSessionIds = new Set(local.map((c) => c.sessionId).filter(Boolean));
        const hiddenIds = new Set(await getHiddenRemoteIds());
        const remoteOnly = remoteSessions
            .map(fromRemoteSession)
            .filter((c) => !localSessionIds.has(c.sessionId) && !hiddenIds.has(c.id));

        return [...local, ...remoteOnly].sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
    } catch (err) {
        console.warn('Failed to fetch synced conversations:', err?.message);
        return local;
    }
}

/** Removes a local entry, or — for a remote-only (cross-device synced) entry — hides it on this device. */
export async function removeSavedConversation(id) {
    const existing = await getLocalConversations();
    if (existing.some((c) => c.id === id)) {
        const next = existing.filter((c) => c.id !== id);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
        const hidden = await getHiddenRemoteIds();
        if (!hidden.includes(id)) {
            await AsyncStorage.setItem(HIDDEN_REMOTE_KEY, JSON.stringify([...hidden, id]));
        }
    }
    return getSavedConversations();
}
