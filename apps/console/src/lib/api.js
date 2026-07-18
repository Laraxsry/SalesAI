import { useAuthStore } from '../store/auth.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

let refreshPromise = null;

/** Exchanges the stored refresh token for a new access token. De-duped across concurrent 401s. */
function refreshAccessToken() {
    if (!refreshPromise) {
        refreshPromise = apiFetch('/auth/refresh', {
            method: 'POST',
            body: { refreshToken: useAuthStore.getState().refreshToken },
            auth: false
        })
            .then((tokens) => {
                useAuthStore.getState().setSession(tokens);
                return tokens.accessToken;
            })
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
}

/** Fetch wrapper that prefixes the API base URL, attaches the JWT + workspace, and throws on non-2xx. */
export async function apiFetch(path, { method = 'GET', body, auth = true, workspace = true, _retried = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
        const { accessToken, workspace: ws } = useAuthStore.getState();
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        if (workspace && ws?.id) headers['x-workspace-id'] = ws.id;
    }

    const res = await fetch(`${API_URL}/api/v1${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 401 && auth && !_retried && useAuthStore.getState().refreshToken) {
        try {
            await refreshAccessToken();
            return apiFetch(path, { method, body, auth, workspace, _retried: true });
        } catch {
            useAuthStore.getState().logout();
            window.location.href = '/login';
            throw new Error('Session expired');
        }
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
}

export const authApi = {
    register: (payload) => apiFetch('/auth/register', { method: 'POST', body: payload, auth: false }),
    login: (payload) => apiFetch('/auth/login', { method: 'POST', body: payload, auth: false })
};

export const workspacesApi = {
    list: () => apiFetch('/workspaces')
};

export const productsApi = {
    list: (workspaceId) => apiFetch(`/products?workspaceId=${workspaceId}`),
    get: (id) => apiFetch(`/products/${id}`),
    create: (payload) => apiFetch('/products', { method: 'POST', body: payload })
};

export const knowledgeApi = {
    list: (productId) => apiFetch(`/knowledge/${productId}`),
    create: (payload) => apiFetch('/knowledge', { method: 'POST', body: payload }),
    remove: (id) => apiFetch(`/knowledge/${id}`, { method: 'DELETE' }),
    uploadUrl: (filename, contentType) =>
        apiFetch('/knowledge/upload-url', { method: 'POST', body: { filename, contentType } }),
    /** Uploads a file straight to storage via a presigned URL (bypasses our API/JSON pipeline). */
    async uploadFile(file) {
        const { url, fileKey } = await this.uploadUrl(file.name, file.type || 'application/octet-stream');
        const res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        if (!res.ok) throw new Error('Dosya yüklenemedi');
        return { fileKey, mimeType: file.type };
    }
};

export const agentsApi = {
    list: (productId) => apiFetch(`/agents?productId=${productId}`),
    get: (id) => apiFetch(`/agents/${id}`),
    create: (payload) => apiFetch('/agents', { method: 'POST', body: payload }),
    activate: (id) => apiFetch(`/agents/${id}/activate`, { method: 'POST' }),
    pause: (id) => apiFetch(`/agents/${id}/pause`, { method: 'POST' })
};

export const leadsApi = {
    list: (workspaceId, { status } = {}) =>
        apiFetch(`/analytics/leads?workspaceId=${workspaceId}${status ? `&status=${status}` : ''}`),
    updateStatus: (id, status) => apiFetch(`/analytics/leads/${id}/status`, { method: 'PATCH', body: { status } })
};
