import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth.js';
import { workspacesApi } from './api.js';

/**
 * Login doesn't return a workspace (only register does). Fetch the user's
 * first workspace once so every product/knowledge/agent call has one.
 */
export function RequireAuth({ children }) {
    const accessToken = useAuthStore((s) => s.accessToken);
    const workspace = useAuthStore((s) => s.workspace);
    const setSession = useAuthStore((s) => s.setSession);
    const location = useLocation();
    const [resolving, setResolving] = useState(!workspace && !!accessToken);

    useEffect(() => {
        if (!accessToken || workspace) return;
        setResolving(true);
        workspacesApi
            .list()
            .then((list) => {
                if (list[0]) setSession({ workspace: list[0], accessToken });
            })
            .finally(() => setResolving(false));
    }, [accessToken, workspace, setSession]);

    if (!accessToken) {
        return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    }
    if (resolving) {
        return <div className="flex min-h-screen items-center justify-center text-sm text-text-muted">Yükleniyor…</div>;
    }
    return children;
}
