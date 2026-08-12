import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MessageSquare, User, Bot as BotIcon, Search } from 'lucide-react';
import { agentsApi, sessionsApi } from '../lib/api.js';

const STATUS_STYLE = {
    live: 'text-emerald-400 bg-emerald-500/10',
    ended: 'text-text-muted bg-surface-raised',
    failed: 'text-red-400 bg-red-500/10'
};

const STATUS_LABEL = {
    live: 'Canlı',
    ended: 'Bitti',
    failed: 'Başarısız'
};

function formatDuration(startedAt, endedAt) {
    if (!startedAt || !endedAt) return '—';
    const seconds = Math.round((new Date(endedAt) - new Date(startedAt)) / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function TranscriptPanel({ sessionId }) {
    const { data: messages, isLoading: messagesLoading } = useQuery({
        queryKey: ['session-transcript', sessionId],
        queryFn: () => sessionsApi.transcript(sessionId),
        enabled: !!sessionId
    });

    const { data: summary } = useQuery({
        queryKey: ['session-summary', sessionId],
        queryFn: () => sessionsApi.summary(sessionId),
        enabled: !!sessionId,
        retry: false
    });

    return (
        <div className="flex flex-col gap-4">
            {summary && (
                <div className="rounded-[var(--radius-card)] border border-brand/30 bg-brand/5 p-4">
                    <h4 className="mb-2 text-xs font-semibold uppercase text-brand-light">Özet</h4>
                    {summary.tldr && <p className="mb-2 text-sm text-text">{summary.tldr}</p>}
                    <div className="flex flex-wrap gap-1.5">
                        {summary.topics?.map((t) => (
                            <span key={t} className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-muted">{t}</span>
                        ))}
                    </div>
                    {summary.nextStep && (
                        <p className="mt-2 text-xs text-text-muted">Sonraki adım: {summary.nextStep}</p>
                    )}
                </div>
            )}

            {messagesLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}
            {!messagesLoading && messages?.length === 0 && (
                <p className="text-sm text-text-muted">Henüz mesaj yok.</p>
            )}

            <div className="flex flex-col gap-2">
                {messages?.map((m) => (
                    <div
                        key={m._id}
                        className={`flex items-start gap-2 rounded-[var(--radius-input)] border border-border p-3 ${
                            m.role === 'assistant' ? 'bg-brand/5' : 'bg-surface'
                        }`}
                    >
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-text-muted">
                            {m.role === 'assistant' ? <BotIcon size={12} /> : <User size={12} />}
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-text">{m.text}</p>
                            <p className="mt-1 text-[11px] text-text-muted">{new Date(m.at).toLocaleTimeString('tr-TR')}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function AgentSessions() {
    const { id } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedSessionId = searchParams.get('session') || '';
    const [query, setQuery] = useState('');

    const { data: sessions, isLoading } = useQuery({
        queryKey: ['agent-sessions', id],
        queryFn: () => agentsApi.sessions(id)
    });

    const { data: searchResults, isFetching: searching } = useQuery({
        queryKey: ['session-search', id, query],
        queryFn: () => sessionsApi.search({ q: query, agentId: id }),
        enabled: query.trim().length >= 2
    });

    function selectSession(sessionId) {
        setSearchParams({ session: sessionId });
    }

    return (
        <div>
            <Link
                to={`/agents/${id}`}
                className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
            >
                <ArrowLeft size={14} />
                Agent detayı
            </Link>

            <div className="mb-6">
                <h1 className="text-xl font-semibold text-text">Oturumlar & Transkriptler</h1>
                <p className="mt-1 text-sm text-text-muted">Bu agent'ın tüm konuşmalarını incele.</p>
            </div>

            <div className="relative mb-6 max-w-md">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Transkriptte ara…"
                    className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-surface pl-9 pr-3 text-sm text-text outline-none focus:border-brand"
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
                <div className="flex flex-col gap-2">
                    {query.trim().length >= 2 ? (
                        <>
                            <h3 className="text-xs font-semibold uppercase text-text-muted">Arama sonuçları</h3>
                            {searching && <p className="text-sm text-text-muted">Aranıyor…</p>}
                            {!searching && searchResults?.results?.length === 0 && (
                                <p className="text-sm text-text-muted">Sonuç bulunamadı.</p>
                            )}
                            {searchResults?.results?.map((m) => (
                                <button
                                    key={m._id}
                                    onClick={() => selectSession(m.sessionId)}
                                    className={`rounded-[var(--radius-input)] border p-3 text-left text-sm transition-colors ${
                                        selectedSessionId === m.sessionId
                                            ? 'border-brand bg-brand/10'
                                            : 'border-border bg-surface hover:border-brand/50'
                                    }`}
                                >
                                    <p className="line-clamp-2 text-text">{m.text}</p>
                                    <p className="mt-1 text-xs text-text-muted">{new Date(m.at).toLocaleString('tr-TR')}</p>
                                </button>
                            ))}
                        </>
                    ) : (
                        <>
                            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}
                            {!isLoading && sessions?.length === 0 && (
                                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                                    <MessageSquare size={24} className="mb-3 text-text-muted" />
                                    <p className="text-sm text-text-muted">Henüz oturum yok.</p>
                                </div>
                            )}
                            {sessions?.map((s) => (
                                <button
                                    key={s._id}
                                    onClick={() => selectSession(s._id)}
                                    className={`rounded-[var(--radius-input)] border p-3 text-left transition-colors ${
                                        selectedSessionId === s._id
                                            ? 'border-brand bg-brand/10'
                                            : 'border-border bg-surface hover:border-brand/50'
                                    }`}
                                >
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="truncate text-sm font-medium text-text">
                                            {s.confirmedContact?.name || s.visitorName || s.confirmedContact?.email
                                                || s.lead?.name || s.lead?.email || 'Anonim ziyaretçi'}
                                        </span>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[s.status]}`}>
                                            {STATUS_LABEL[s.status]}
                                        </span>
                                    </div>
                                    <p className="text-xs text-text-muted">
                                        {new Date(s.startedAt).toLocaleString('tr-TR')} · {formatDuration(s.startedAt, s.endedAt)}
                                    </p>
                                </button>
                            ))}
                        </>
                    )}
                </div>

                <div>
                    {selectedSessionId ? (
                        <TranscriptPanel sessionId={selectedSessionId} />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                            <MessageSquare size={24} className="mb-3 text-text-muted" />
                            <p className="text-sm text-text-muted">Bir oturum seç.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
