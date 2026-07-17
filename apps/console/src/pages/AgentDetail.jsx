import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui';
import { ArrowLeft, Bot, Rocket, Pause, Copy, Check, ExternalLink, AlertCircle } from 'lucide-react';
import { agentsApi } from '../lib/api.js';

const STATUS_STYLE = {
    draft: 'text-text-muted bg-surface-raised',
    active: 'text-emerald-400 bg-emerald-500/10',
    paused: 'text-amber-400 bg-amber-500/10',
    archived: 'text-text-muted bg-surface-raised'
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
    const queryClient = useQueryClient();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const { data: agent, isLoading } = useQuery({
        queryKey: ['agent', id],
        queryFn: () => agentsApi.get(id)
    });

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

    // Embed Studio (widget loader + theming) is a later phase — for now the
    // simplest working embed is an iframe onto the visitor app's embed mode.
    const embedSnippet = agent.shareUrl
        ? `<iframe src="${agent.shareUrl}?embed=1" style="border:0;width:400px;height:600px" allow="microphone"></iframe>`
        : null;

    return (
        <div>
            <Link
                to={`/agents?product=${agent.productId}`}
                className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
            >
                <ArrowLeft size={14} />
                Agents
            </Link>

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
                            <dt className="text-text-muted">Ton</dt>
                            <dd className="text-right text-text">{agent.persona?.tone}</dd>
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

                    <h3 className="mb-2 text-sm font-semibold text-text">Embed snippet</h3>
                    <div className="flex items-start gap-2">
                        <pre className="flex-1 overflow-x-auto rounded-[var(--radius-input)] border border-border bg-bg px-3 py-2 text-xs text-text-muted">
                            {embedSnippet}
                        </pre>
                        <CopyButton text={embedSnippet} />
                    </div>
                </div>
            )}
        </div>
    );
}
