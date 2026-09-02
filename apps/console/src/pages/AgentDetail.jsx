import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui';
import { ArrowLeft, Bot, Rocket, Pause, Copy, Check, ExternalLink, AlertCircle, Trash2, MessageSquare, Code, Target } from 'lucide-react';
import { MAX_ROOM_PARTICIPANTS } from '@repo/contracts';
import { agentsApi } from '../lib/api.js';

const STATUS_STYLE = {
    draft: 'text-text-muted bg-surface-raised',
    active: 'text-emerald-400 bg-emerald-500/10',
    paused: 'text-amber-400 bg-amber-500/10',
    archived: 'text-text-muted bg-surface-raised'
};

// Mirrors apps/console/src/pages/Agents.jsx's ARCHETYPES — kept as separate
// local copies (display labels only) to match this codebase's existing
// per-page constant convention (STATUS_LABEL etc. below are the same pattern).
const ARCHETYPE_LABEL = {
    marketing: 'Pazarlama',
    technical: 'Teknik'
};

const STATUS_LABEL = {
    draft: 'Taslak',
    active: 'Aktif',
    paused: 'Duraklatıldı',
    archived: 'Arşivlendi'
};

function CopyButton({ text }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() => {
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1.5 rounded-[var(--radius-input)] border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-brand/50"
        >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Kopyalandı' : 'Kopyala'}
        </button>
    );
}

export function AgentDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const { data: agent, isLoading } = useQuery({
        queryKey: ['agent', id],
        queryFn: () => agentsApi.get(id)
    });

    // Inline editor for "how many customers at once" — the only agent field
    // that needs changing after creation for an existing agent to go multi-
    // participant (there's otherwise no edit form on this page).
    const [maxP, setMaxP] = useState('');
    const currentMaxP = agent?.maxParticipants ?? 1;
    const maxPDirty = maxP !== '' && Number(maxP) !== currentMaxP;

    async function saveMaxParticipants() {
        setError('');
        setBusy(true);
        try {
            await agentsApi.update(id, { maxParticipants: Number(maxP) });
            await queryClient.invalidateQueries({ queryKey: ['agent', id] });
            setMaxP('');
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function togglePreCallSurvey() {
        setError('');
        setBusy(true);
        try {
            await agentsApi.update(id, { preCallSurveyEnabled: !agent.preCallSurveyEnabled });
            await queryClient.invalidateQueries({ queryKey: ['agent', id] });
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function onDelete() {
        if (!confirm(`"${agent.name}" agent'ını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) return;
        setError('');
        setBusy(true);
        try {
            await agentsApi.remove(id);
            queryClient.invalidateQueries({ queryKey: ['agents', agent.productId] });
            navigate(`/agents?product=${agent.productId}`);
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    }

    async function onActivate() {
        setError('');
        setBusy(true);
        try {
            await agentsApi.activate(id);
            queryClient.invalidateQueries({ queryKey: ['agent', id] });
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function onPause() {
        setError('');
        setBusy(true);
        try {
            await agentsApi.pause(id);
            queryClient.invalidateQueries({ queryKey: ['agent', id] });
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    if (isLoading) return <p className="text-sm text-text-muted">Yükleniyor…</p>;
    if (!agent) return <p className="text-sm text-red-400">Agent bulunamadı</p>;

    return (
        <div>
            <div className="mb-6 flex items-center justify-between">
                <Link
                    to={`/agents?product=${agent.productId}`}
                    className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
                >
                    <ArrowLeft size={14} />
                    Agents
                </Link>
                <button
                    onClick={onDelete}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                    <Trash2 size={14} />
                    Agent'ı sil
                </button>
            </div>

            <div className="mb-6 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/15 text-brand-light">
                    <Bot size={20} />
                </span>
                <div>
                    <h1 className="text-2xl font-bold text-text">{agent.name}</h1>
                    <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[agent.status]}`}>
                        {STATUS_LABEL[agent.status]}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                    <h3 className="mb-3 text-sm font-semibold text-text">Persona</h3>
                    <dl className="flex flex-col gap-2 text-sm">
                        <div className="flex justify-between gap-4">
                            <dt className="text-text-muted">Karakter</dt>
                            <dd className="text-right text-text">
                                {ARCHETYPE_LABEL[agent.persona?.archetype] || agent.persona?.tone}
                            </dd>
                        </div>
                        <div className="flex justify-between gap-4">
                            <dt className="text-text-muted">Dil</dt>
                            <dd className="text-text">{agent.persona?.language?.toUpperCase()}</dd>
                        </div>
                        {agent.persona?.goals?.length > 0 && (
                            <div className="flex justify-between gap-4">
                                <dt className="text-text-muted">Hedefler</dt>
                                <dd className="text-right text-text">{agent.persona.goals.join(', ')}</dd>
                            </div>
                        )}
                    </dl>
                </div>

                <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                    <h3 className="mb-3 text-sm font-semibold text-text">Yapılandırma</h3>
                    <dl className="flex flex-col gap-2 text-sm">
                        <div className="flex justify-between gap-4">
                            <dt className="text-text-muted">Avatar</dt>
                            <dd className="text-text">{agent.avatarProvider}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                            <dt className="text-text-muted">Ekran modları</dt>
                            <dd className="text-right text-text">{agent.screenModes?.join(', ') || '—'}</dd>
                        </div>
                        <div className="flex items-start justify-between gap-4">
                            <dt className="pt-1.5 text-text-muted">Katılımcı</dt>
                            <dd className="flex flex-col items-end gap-1.5">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={1}
                                        max={MAX_ROOM_PARTICIPANTS}
                                        value={maxP === '' ? currentMaxP : maxP}
                                        onChange={(e) => setMaxP(e.target.value)}
                                        className="h-8 w-16 rounded-[var(--radius-input)] border border-border bg-bg px-2 text-right text-sm text-text outline-none focus:border-brand"
                                    />
                                    <span className="text-xs text-text-muted">müşteri</span>
                                    {maxPDirty && (
                                        <button
                                            type="button"
                                            onClick={saveMaxParticipants}
                                            disabled={busy}
                                            className="rounded-[var(--radius-input)] bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                        >
                                            Kaydet
                                        </button>
                                    )}
                                </div>
                                <span className="text-[11px] text-text-muted">
                                    {currentMaxP > 1
                                        ? 'Grup toplantısı — agent bu sayıya dahil değil'
                                        : '1 = birebir görüşme'}
                                </span>
                            </dd>
                        </div>
                        {currentMaxP <= 1 && (
                            <div className="flex items-start justify-between gap-4">
                                <dt className="pt-1 text-text-muted">Ön anket</dt>
                                <dd className="flex flex-col items-end gap-1">
                                    <button
                                        type="button"
                                        onClick={togglePreCallSurvey}
                                        disabled={busy}
                                        className={`rounded-[var(--radius-input)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                                            agent.preCallSurveyEnabled
                                                ? 'bg-brand text-white'
                                                : 'border border-border text-text-muted'
                                        }`}
                                    >
                                        {agent.preCallSurveyEnabled ? 'Açık' : 'Kapalı'}
                                    </button>
                                    <span className="text-[11px] text-text-muted">
                                        Birebir görüşmede ziyaretçi kısa anket doldurur
                                    </span>
                                </dd>
                            </div>
                        )}
                    </dl>
                </div>
            </div>

            {error && (
                <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                    <AlertCircle size={16} className="shrink-0" />
                    {error}
                </div>
            )}

            <div className="mt-6 flex gap-3">
                {agent.status !== 'active' && (
                    <Button onClick={onActivate} disabled={busy}>
                        <Rocket size={16} />
                        {busy ? 'Yayına alınıyor…' : 'Aktive et'}
                    </Button>
                )}
                {agent.status === 'active' && (
                    <Button variant="secondary" onClick={onPause} disabled={busy}>
                        <Pause size={16} />
                        {busy ? 'Duraklatılıyor…' : 'Duraklat'}
                    </Button>
                )}
                <Link
                    to={`/agents/${id}/goals`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-input)] bg-transparent px-4 text-sm font-semibold text-text-muted transition-all hover:bg-surface-raised hover:text-text"
                >
                    <Target size={16} />
                    Hedefler
                </Link>
                <Link
                    to={`/agents/${id}/sessions`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-input)] bg-transparent px-4 text-sm font-semibold text-text-muted transition-all hover:bg-surface-raised hover:text-text"
                >
                    <MessageSquare size={16} />
                    Oturumlar
                </Link>
                <Link
                    to={`/agents/${id}/embed`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-input)] bg-transparent px-4 text-sm font-semibold text-text-muted transition-all hover:bg-surface-raised hover:text-text"
                >
                    <Code size={16} />
                    Embed Studio
                </Link>
            </div>

            {agent.shareUrl && (
                <div className="mt-8 rounded-[var(--radius-card)] border border-brand/30 bg-brand/5 p-5">
                    <h3 className="mb-3 text-sm font-semibold text-text">Paylaşım linki</h3>
                    <div className="mb-4 flex items-center gap-2">
                        <a
                            href={agent.shareUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex flex-1 items-center gap-1.5 truncate rounded-[var(--radius-input)] border border-border bg-bg px-3 py-2 text-sm text-brand-light hover:text-brand"
                        >
                            <ExternalLink size={13} className="shrink-0" />
                            <span className="truncate">{agent.shareUrl}</span>
                        </a>
                        <CopyButton text={agent.shareUrl} />
                    </div>
                </div>
            )}
        </div>
    );
}
