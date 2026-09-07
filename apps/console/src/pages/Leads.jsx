import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Mail, Building2, X, Phone, StickyNote, CalendarDays, Search, ChevronRight, Clock, CheckCircle2 } from 'lucide-react';
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

function displayName(lead) {
    return lead.contact?.name || lead.contact?.email || lead.session?.visitorName || 'Anonim lead';
}

function formatLeadDate(value) {
    return value ? new Date(value).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Tarih yok';
}

export function Leads() {
    const workspace = useAuthStore((s) => s.workspace);
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState(undefined);
    const [selectedLead, setSelectedLead] = useState(null);
    const [search, setSearch] = useState('');

    const { data, isLoading, error } = useQuery({
        queryKey: ['leads', workspace?.id, statusFilter],
        queryFn: () => leadsApi.list(workspace.id, { status: statusFilter }),
        enabled: !!workspace?.id
    });

    async function onStatusChange(lead, status) {
        await leadsApi.updateStatus(lead._id, status);
        setSelectedLead((current) => current?._id === lead._id ? { ...current, status } : current);
        queryClient.invalidateQueries({ queryKey: ['leads', workspace?.id] });
    }

    const leads = data?.leads ?? [];
    const normalizedSearch = search.trim().toLocaleLowerCase('tr-TR');
    const visibleLeads = normalizedSearch
        ? leads.filter((lead) => [displayName(lead), lead.contact?.email, lead.contact?.phone, lead.contact?.company, lead.summary?.tldr]
            .filter(Boolean).some((value) => value.toLocaleLowerCase('tr-TR').includes(normalizedSearch)))
        : leads;
    const counts = data?.statusCounts || {};

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
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

            <div className="mb-5 grid grid-cols-3 gap-3">
                <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4"><p className="text-xs text-text-muted">Toplam lead</p><p className="mt-1 text-2xl font-semibold text-text">{(counts.new || 0) + (counts.qualified || 0) + (counts.dismissed || 0)}</p></div>
                <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4"><p className="text-xs text-text-muted">Yeni</p><p className="mt-1 text-2xl font-semibold text-brand-light">{counts.new || 0}</p></div>
                <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4"><p className="text-xs text-text-muted">Nitelikli</p><p className="mt-1 text-2xl font-semibold text-emerald-400">{counts.qualified || 0}</p></div>
            </div>

            <div className="relative mb-4">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ad, e-posta, şirket veya görüşme özeti ara…" className="h-11 w-full rounded-[var(--radius-input)] border border-border bg-surface pl-10 pr-4 text-sm text-text outline-none placeholder:text-text-muted focus:border-brand" />
            </div>

            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}
            {error && <p className="text-sm text-red-400">{error.message}</p>}

            {!isLoading && visibleLeads.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <Users size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">{leads.length ? 'Aramanla eşleşen lead yok.' : 'Henüz lead yakalanmadı.'}</p>
                </div>
            )}

            {visibleLeads.length > 0 && (
                <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                    <div className="hidden grid-cols-[minmax(180px,1.4fr)_minmax(220px,2fr)_90px_120px_24px] gap-4 border-b border-border px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted md:grid">
                        <span>Müşteri</span><span>Görüşme</span><span>Skor</span><span>Durum</span><span />
                    </div>
                    {visibleLeads.map((lead) => (
                        <button
                            type="button"
                            key={lead._id}
                            onClick={() => setSelectedLead(lead)}
                            className="grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-border px-5 py-4 text-left transition last:border-b-0 hover:bg-surface-raised/60 md:grid-cols-[minmax(180px,1.4fr)_minmax(220px,2fr)_90px_120px_24px]"
                        >
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-light"><Users size={16} /></span>
                                <div className="min-w-0"><p className="truncate text-sm font-semibold text-text">{displayName(lead)}</p><p className="mt-0.5 truncate text-xs text-text-muted">{lead.contact?.email || lead.contact?.phone || 'İletişim bilgisi alınmadı'}</p></div>
                            </div>
                            <div className="hidden min-w-0 md:block"><p className="truncate text-sm text-text">{lead.summary?.tldr || 'Görüşme özeti hazırlanıyor'}</p><p className="mt-1 flex items-center gap-1 text-xs text-text-muted"><Clock size={12} />{formatLeadDate(lead.session?.startedAt || lead.createdAt)}</p></div>
                            <div className="hidden md:block"><p className="text-lg font-semibold text-text">{lead.score}</p><div className="mt-1 h-1.5 w-14 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, lead.score))}%` }} /></div></div>
                            <div className="flex justify-end md:justify-start">
                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
                            </div>
                            <ChevronRight size={16} className="hidden text-text-muted md:block" />
                        </button>
                    ))}
                </div>
            )}

            {selectedLead && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setSelectedLead(null)}>
                    <aside className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-bg p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="mb-6 flex items-start justify-between">
                            <div>
                                <p className="text-xs font-medium uppercase tracking-wider text-brand-light">Lead detayı</p>
                                <h2 className="mt-1 text-xl font-semibold text-text">{displayName(selectedLead)}</h2>
                            </div>
                            <button type="button" aria-label="Kapat" onClick={() => setSelectedLead(null)} className="rounded-full p-2 text-text-muted hover:bg-surface-raised hover:text-text"><X size={18} /></button>
                        </div>
                        <div className="space-y-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
                            {selectedLead.contact?.email && <a href={`mailto:${selectedLead.contact.email}`} className="flex items-center gap-2 text-brand-light"><Mail size={15} />{selectedLead.contact.email}</a>}
                            {selectedLead.contact?.phone && <p className="flex items-center gap-2 text-text-muted"><Phone size={15} />{selectedLead.contact.phone}</p>}
                            {selectedLead.contact?.company && <p className="flex items-center gap-2 text-text-muted"><Building2 size={15} />{selectedLead.contact.company}</p>}
                            <p className="text-text-muted">Skor: <span className="font-semibold text-text">{selectedLead.score}</span></p>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2">{['new', 'qualified', 'dismissed'].map((status) => <button type="button" key={status} onClick={() => onStatusChange(selectedLead, status)} className={`rounded-lg border px-2 py-2 text-xs font-medium ${selectedLead.status === status ? 'border-brand bg-brand text-white' : 'border-border text-text-muted hover:text-text'}`}>{STATUS_LABEL[status]}</button>)}</div>
                        {selectedLead.summary && <section className="mt-6"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-text"><StickyNote size={15} />Görüşme özeti</h3><div className="rounded-[var(--radius-card)] border border-border bg-surface p-4"><p className="text-sm leading-6 text-text-muted">{selectedLead.summary.tldr || 'Özet mevcut değil.'}</p>{selectedLead.summary.nextStep && <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-sm text-text"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />{selectedLead.summary.nextStep}</p>}</div></section>}
                        {selectedLead.surveyAnswers?.length > 0 && <section className="mt-6"><h3 className="mb-2 text-sm font-semibold text-text">Survey cevapları</h3><div className="space-y-2">{selectedLead.surveyAnswers.map((answer, index) => <div key={`${answer.nodeId || 'answer'}-${index}`} className="rounded-lg border border-border bg-surface p-3 text-sm"><p className="text-xs text-text-muted">{answer.question || answer.fieldKey || 'Özel soru'}</p><p className="mt-1 text-text">{answer.answer || 'Atlandı'}</p></div>)}</div></section>}
                        {selectedLead.availability?.date && <section className="mt-6"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-text"><CalendarDays size={15} />Uygunluk</h3><p className="text-sm text-text-muted">{selectedLead.availability.date}{selectedLead.availability.timeRange ? ` · ${selectedLead.availability.timeRange}` : ''}</p></section>}
                    </aside>
                </div>
            )}
        </div>
    );
}
