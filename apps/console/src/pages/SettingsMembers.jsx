import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Button, Input } from '@repo/ui';
import { UserPlus, Mail, X, AlertCircle, Trash2 } from 'lucide-react';
import { workspacesApi, membershipsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { SettingsTabs } from '../lib/SettingsTabs.jsx';

const ROLES = ['ADMIN', 'EDITOR', 'VIEWER'];

const ROLE_LABEL = {
    OWNER: 'Sahip',
    ADMIN: 'Yönetici',
    EDITOR: 'Editör',
    VIEWER: 'İzleyici'
};

function InviteForm({ workspaceId, onInvited }) {
    const [error, setError] = useState('');
    const {
        register,
        handleSubmit,
        reset,
        formState: { isSubmitting }
    } = useForm({ defaultValues: { email: '', role: 'EDITOR' } });

    async function onSubmit(values) {
        setError('');
        try {
            await workspacesApi.invite(workspaceId, values);
            reset();
            onInvited();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="mb-6 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
                <Input id="invite-email" label="E-posta ile davet et" type="email" placeholder="ad@sirket.com" required {...register('email')} />
            </div>
            <label className="mb-4 block text-sm">
                <span className="mb-1.5 block font-medium text-text-muted">Rol</span>
                <select
                    {...register('role')}
                    className="h-10 rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none focus:border-brand"
                >
                    {ROLES.map((r) => (
                        <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                        </option>
                    ))}
                </select>
            </label>
            <Button type="submit" disabled={isSubmitting} className="mb-4">
                <UserPlus size={16} />
                {isSubmitting ? 'Gönderiliyor…' : 'Davet gönder'}
            </Button>
            {error && (
                <div className="mb-4 flex w-full items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                    <AlertCircle size={16} className="shrink-0" />
                    {error}
                </div>
            )}
        </form>
    );
}

export function SettingsMembers() {
    const workspace = useAuthStore((s) => s.workspace);
    const queryClient = useQueryClient();

    const { data: members, isLoading } = useQuery({
        queryKey: ['members', workspace?.id],
        queryFn: () => workspacesApi.members(workspace.id),
        enabled: !!workspace?.id
    });

    const { data: invitations } = useQuery({
        queryKey: ['invitations', workspace?.id],
        queryFn: () => workspacesApi.invitations(workspace.id),
        enabled: !!workspace?.id
    });

    function invalidate() {
        queryClient.invalidateQueries({ queryKey: ['members', workspace?.id] });
        queryClient.invalidateQueries({ queryKey: ['invitations', workspace?.id] });
    }

    async function onRoleChange(member, role) {
        await membershipsApi.updateRole(member.id, role);
        invalidate();
    }

    async function onRemove(member) {
        await membershipsApi.remove(member.id);
        invalidate();
    }

    async function onRevokeInvite(invitationId) {
        await workspacesApi.revokeInvitation(workspace.id, invitationId);
        invalidate();
    }

    const canManage = workspace?.role === 'OWNER' || workspace?.role === 'ADMIN';

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-xl font-semibold text-text">Ayarlar</h1>
                <p className="mt-1 text-sm text-text-muted">Ekip üyelerini ve davetleri yönet.</p>
            </div>

            <SettingsTabs />

            {canManage && <InviteForm workspaceId={workspace.id} onInvited={invalidate} />}

            <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold text-text-muted">Üyeler</h2>
                {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}
                {members?.length > 0 && (
                    <div className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                        {members.map((m) => (
                            <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-text">{m.name}</p>
                                    <p className="truncate text-xs text-text-muted">{m.email}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    {canManage && m.role !== 'OWNER' ? (
                                        <select
                                            value={m.role}
                                            onChange={(e) => onRoleChange(m, e.target.value)}
                                            className="h-8 rounded-[var(--radius-input)] border border-border bg-bg px-2 text-xs text-text outline-none focus:border-brand"
                                        >
                                            {ROLES.map((r) => (
                                                <option key={r} value={r}>
                                                    {ROLE_LABEL[r]}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span className="rounded-full bg-surface-raised px-2.5 py-1 text-xs text-text-muted">
                                            {ROLE_LABEL[m.role]}
                                        </span>
                                    )}
                                    {canManage && m.role !== 'OWNER' && (
                                        <button
                                            onClick={() => onRemove(m)}
                                            title="Üyeyi çıkar"
                                            className="text-text-muted transition-colors hover:text-red-400"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {invitations?.length > 0 && (
                <section>
                    <h2 className="mb-3 text-sm font-semibold text-text-muted">Bekleyen davetler</h2>
                    <div className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                        {invitations.map((inv) => (
                            <div key={inv.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                                <div className="flex items-center gap-2 text-sm text-text">
                                    <Mail size={14} className="text-text-muted" />
                                    {inv.email}
                                    <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-muted">
                                        {ROLE_LABEL[inv.role]}
                                    </span>
                                </div>
                                {canManage && (
                                    <button
                                        onClick={() => onRevokeInvite(inv.id)}
                                        title="Daveti iptal et"
                                        className="text-text-muted transition-colors hover:text-red-400"
                                    >
                                        <X size={15} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
