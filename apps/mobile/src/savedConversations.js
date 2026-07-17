import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'salesai:saved-conversations';
const MAX_SAVED = 20;

/**
 * Phase 3 (mock): the backend doesn't expose `GET /sessions/mine` yet, so
 * "saved conversations" lives entirely on-device — just enough to demo the
 * Saved screen UX until that endpoint exists.
 */
export async function saveConversation({ token, agentName }) {
    if (!token) return;
    try {
        const existing = await getSavedConversations();
        const entry = {
            id: `${token}_${Date.now()}`,
            token,
            agentName: agentName || 'AI Representative',
            endedAt: new Date().toISOString()
        };
        const next = [entry, ...existing.filter((c) => c.token !== token)].slice(0, MAX_SAVED);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
        console.warn('Failed to save conversation locally:', err?.message);
    }
}

export async function getSavedConversations() {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export async function removeSavedConversation(id) {
    const existing = await getSavedConversations();
    const next = existing.filter((c) => c.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
}
