import { useQuery } from '@tanstack/react-query';
import { Building2, Check } from 'lucide-react';
import { workspacesApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

function initials(name = '') {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join('') || '?';
}

export function Settings() {
    const user = useAuthStore((s) => s.user);
    const activeWorkspace = useAuthStore((s) => s.workspace);
    const setSession = useAuthStore((s) => s.setSession);

    const { data: workspaces, isLoading } = useQuery({
        queryKey: ['workspaces'],
        queryFn: () => workspacesApi.list()
    });

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-xl font-semibold text-text">Ayarlar</h1>
                <p className="mt-1 text-sm text-text-muted">Hesabını ve çalışma alanlarını yönet.</p>
            </div>

            <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold text-text-muted">Hesap</h2>
                <div className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/20 text-sm font-bold text-brand-light">
                        {initials(user?.name || user?.email)}
                    </span>
                    <div>
                        <p className="font-semibold text-text">{user?.name || 'Kullanıcı'}</p>
                        <p className="text-sm text-text-muted">{user?.email}</p>
                    </div>
                </div>
            </section>

            <section>
                <h2 className="mb-3 text-sm font-semibold text-text-muted">Workspace'ler</h2>

                {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}

                {workspaces?.length > 0 && (
                    <div className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                        {workspaces.map((ws) => {
                            const isActive = ws.id === activeWorkspace?.id;
                            return (
                                <button
                                    key={ws.id}
                                    onClick={() => setSession({ workspace: ws })}
                                    className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-surface-raised"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-brand-light">
                                            <Building2 size={16} />
                                        </span>
                                        <div>
                                            <p className={`text-sm font-medium ${isActive ? 'text-brand-light' : 'text-text'}`}>{ws.name}</p>
                                            <p className="text-xs text-text-muted">{ws.role}</p>
                                        </div>
                                    </div>
                                    {isActive && <Check size={16} className="text-brand-light" />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}
