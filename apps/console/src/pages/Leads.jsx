import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Mail, Building2 } from 'lucide-react';
import { leadsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

const STATUS_FILTERS = [
    { value: undefined, label: 'Tümü' },
    { value: 'new', label: 'Yeni' },
    { value: 'qualified', label: 'Nitelikli' },
    { value: 'dismissed', label: 'Reddedildi' }
];

const STATUS_STYLE = {
    new: 'text-brand-light bg-brand/10',
    qualified: 'text-emerald-400 bg-emerald-500/10',
    dismissed: 'text-text-muted bg-surface-raised'
};

const STATUS_LABEL = {
    new: 'Yeni',
    qualified: 'Nitelikli',
    dismissed: 'Reddedildi'
};

export function Leads() {
    const workspace = useAuthStore((s) => s.workspace);
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState(undefined);

    const { data, isLoading, error } = useQuery({
        queryKey: ['leads', workspace?.id, statusFilter],
        queryFn: () => leadsApi.list(workspace.id, { status: statusFilter }),
        enabled: !!workspace?.id
    });

    async function onStatusChange(lead, status) {
        await leadsApi.updateStatus(lead._id, status);
        queryClient.invalidateQueries({ queryKey: ['leads', workspace?.id] });
    }

    const leads = data?.leads ?? [];

    return (
        <div>
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-text">Leads</h1>
                    <p className="mt-1 text-sm text-text-muted">
                        Konuşmalardan çıkarılan müşteri adaylarını takip et ve önceliklendir.
                    </p>
                </div>
                <div className="flex gap-1 rounded-[var(--radius-input)] border border-border bg-surface p-1">
                    {STATUS_FILTERS.map((f) => (
                        <button
                            key={f.label}
                            onClick={() => setStatusFilter(f.value)}
                            className={`rounded-[var(--radius-input)] px-3 py-1.5 text-xs font-medium transition-colors ${
                                statusFilter === f.value
                                    ? 'bg-brand/15 text-brand-light'
                                    : 'text-text-muted hover:text-text'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}
            {error && <p className="text-sm text-red-400">{error.message}</p>}

            {!isLoading && leads.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <Users size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Henüz lead yakalanmadı.</p>
                </div>
            )}

            {leads.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {leads.map((lead) => (
                        <div
                            key={lead._id}
                            className="rounded-[var(--radius-card)] border border-border bg-surface p-5"
                        >
                            <div className="mb-3 flex items-center justify-between">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-brand-light">
                                    <Users size={16} />
                                </span>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[lead.status]}`}>
                                    {STATUS_LABEL[lead.status]}
                                </span>
                            </div>

                            <h3 className="font-semibold text-text">{lead.contact?.name || lead.contact?.email || 'Anonim lead'}</h3>
                            {lead.contact?.company && (
                                <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                                    <Building2 size={12} />
                                    {lead.contact.company}
                                </p>
                            )}
                            <p className="mt-1 text-xs text-text-muted">Skor: {lead.score}</p>

                            <div className="mt-4 flex gap-1.5">
                                {['new', 'qualified', 'dismissed'].map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => onStatusChange(lead, s)}
                                        className={`flex-1 rounded-[var(--radius-input)] border px-2 py-1.5 text-xs font-medium transition-colors ${
                                            lead.status === s
                                                ? 'border-brand bg-brand text-white'
                                                : 'border-border bg-bg text-text-muted hover:text-text'
                                        }`}
                                    >
                                        {STATUS_LABEL[s]}
                                    </button>
                                ))}
                            </div>

                            {lead.contact?.email && (
                                <a
                                    href={`mailto:${lead.contact.email}`}
                                    className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-light hover:text-brand"
                                >
                                    <Mail size={12} />
                                    {lead.contact.email}
                                </a>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
