import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button, Logo } from '@repo/ui';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { invitationsApi, workspacesApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

export function AcceptInvite() {
    const { token } = useParams();
    const navigate = useNavigate();
    const accessToken = useAuthStore((s) => s.accessToken);
    const setSession = useAuthStore((s) => s.setSession);
    const [status, setStatus] = useState('pending');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!accessToken) return;
        let cancelled = false;

        invitationsApi
            .accept(token)
            .then(async (result) => {
                if (cancelled) return;
                const workspace = await workspacesApi.get(result.workspaceId);
                if (cancelled) return;
                setSession({ workspace });
                setStatus('accepted');
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err.message);
                    setStatus('error');
                }
            });

        return () => {
            cancelled = true;
        };
    }, [accessToken, token, setSession]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-bg p-4">
            <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-surface p-8 text-center">
                <div className="mb-6 flex justify-center">
                    <Logo />
                </div>

                {!accessToken && (
                    <>
                        <p className="mb-4 text-sm text-text-muted">
                            Daveti kabul etmek için önce giriş yapmalısın.
                        </p>
                        <Link to="/login" state={{ from: `/invite/${token}` }}>
                            <Button className="w-full">Giriş yap</Button>
                        </Link>
                    </>
                )}

                {accessToken && status === 'pending' && (
                    <>
                        <Loader2 size={28} className="mx-auto mb-4 animate-spin text-brand-light" />
                        <p className="text-sm text-text-muted">Davet kabul ediliyor…</p>
                    </>
                )}

                {status === 'accepted' && (
                    <>
                        <CheckCircle2 size={28} className="mx-auto mb-4 text-emerald-400" />
                        <p className="mb-4 text-sm text-text">Workspace'e katıldın.</p>
                        <Button className="w-full" onClick={() => navigate('/', { replace: true })}>
                            Devam et
                        </Button>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <XCircle size={28} className="mx-auto mb-4 text-red-400" />
                        <p className="text-sm text-red-400">{error}</p>
                    </>
                )}
            </div>
        </div>
    );
}
