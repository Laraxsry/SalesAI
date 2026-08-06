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
    list: () => apiFetch('/workspaces'),
    get: (id) => apiFetch(`/workspaces/${id}`),
    members: (id) => apiFetch(`/workspaces/${id}/members`),
    invitations: (id) => apiFetch(`/workspaces/${id}/invitations`),
    invite: (id, payload) => apiFetch(`/workspaces/${id}/invitations`, { method: 'POST', body: payload }),
    revokeInvitation: (id, invitationId) => apiFetch(`/workspaces/${id}/invitations/${invitationId}`, { method: 'DELETE' })
};

export const membershipsApi = {
    updateRole: (id, role) => apiFetch(`/memberships/${id}`, { method: 'PATCH', body: { role } }),
    remove: (id) => apiFetch(`/memberships/${id}`, { method: 'DELETE' })
};

export const invitationsApi = {
    accept: (token) => apiFetch(`/invitations/${token}/accept`, { method: 'POST' })
};

export const billingApi = {
    plans: () => apiFetch('/billing/plans', { auth: false }),
    subscription: () => apiFetch('/billing/subscription'),
    usage: () => apiFetch('/billing/usage'),
    checkout: (planKey) =>
        apiFetch('/billing/checkout', {
            method: 'POST',
            body: { planKey, successUrl: `${window.location.origin}/settings/billing`, cancelUrl: `${window.location.origin}/settings/billing` }
        }),
    portal: () =>
        apiFetch('/billing/portal', { method: 'POST', body: { returnUrl: `${window.location.origin}/settings/billing` } })
};

export const apiKeysApi = {
    list: () => apiFetch('/api-keys'),
    create: (payload) => apiFetch('/api-keys', { method: 'POST', body: payload }),
    remove: (id) => apiFetch(`/api-keys/${id}`, { method: 'DELETE' })
};

export const productsApi = {
    list: (workspaceId) => apiFetch(`/products?workspaceId=${workspaceId}`),
    get: (id) => apiFetch(`/products/${id}`),
    create: (payload) => apiFetch('/products', { method: 'POST', body: payload }),
    update: (id, payload) => apiFetch(`/products/${id}`, { method: 'PATCH', body: payload })
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
    pause: (id) => apiFetch(`/agents/${id}/pause`, { method: 'POST' }),
    sessions: (id) => apiFetch(`/agents/${id}/sessions`),
    getEmbed: (id) => apiFetch(`/agents/${id}/embed`),
    saveEmbed: (id, payload) => apiFetch(`/agents/${id}/embed`, { method: 'POST', body: payload })
};

export const leadsApi = {
    list: (workspaceId, { status } = {}) =>
        apiFetch(`/analytics/leads?workspaceId=${workspaceId}${status ? `&status=${status}` : ''}`),
    updateStatus: (id, status) => apiFetch(`/analytics/leads/${id}/status`, { method: 'PATCH', body: { status } })
};

export const analyticsApi = {
    agent: (id, { from, to } = {}) => {
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const qs = params.toString();
        return apiFetch(`/analytics/agents/${id}${qs ? `?${qs}` : ''}`);
    },
    agentSummaries: (id, { limit, skip } = {}) => {
        const params = new URLSearchParams();
        if (limit) params.set('limit', limit);
        if (skip) params.set('skip', skip);
        const qs = params.toString();
        return apiFetch(`/analytics/agents/${id}/summary${qs ? `?${qs}` : ''}`);
    },
    productTopics: (id, { from, to, limit } = {}) => {
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        if (limit) params.set('limit', limit);
        const qs = params.toString();
        return apiFetch(`/analytics/products/${id}/topics${qs ? `?${qs}` : ''}`);
    },
    knowledgeGaps: (productId, { limit } = {}) => {
        const params = new URLSearchParams({ productId });
        if (limit) params.set('limit', limit);
        return apiFetch(`/analytics/knowledge-gaps?${params.toString()}`);
    }
};

export const sessionsApi = {
    get: (id) => apiFetch(`/sessions/${id}`),
    transcript: (id) => apiFetch(`/sessions/${id}/transcript`, { auth: false }),
    summary: (id) => apiFetch(`/sessions/${id}/summary`),
    search: ({ q, agentId, from, to, sentiment, limit, skip }) => {
        const params = new URLSearchParams({ q });
        if (agentId) params.set('agentId', agentId);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        if (sentiment) params.set('sentiment', sentiment);
        if (limit) params.set('limit', limit);
        if (skip) params.set('skip', skip);
        return apiFetch(`/sessions/search?${params.toString()}`);
    },
    remove: (id) => apiFetch(`/sessions/${id}`, { method: 'DELETE' })
};
