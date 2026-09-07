import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Bot, MessageSquare, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import { analyticsApi, agentsApi, productsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { agentSelectionKey, productSelectionKey, rememberSelection, resolveRememberedSelection } from '../lib/selectionMemory.js';

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function KpiCard({ icon: Icon, label, value }) {
    return (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <div className="mb-2 flex items-center gap-2 text-text-muted">
                <Icon size={15} />
                <span className="text-xs font-medium">{label}</span>
            </div>
            <p className="text-2xl font-bold text-text">{value}</p>
        </div>
    );
}

function SessionsChart({ dailyActivity }) {
    if (!dailyActivity?.length) {
        return <p className="text-sm text-text-muted">Henüz veri yok.</p>;
    }
    const byDate = new Map(dailyActivity.map((day) => [day.date, day]));
    const points = Array.from({ length: 30 }, (_, offset) => {
        const date = new Date();
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() - (29 - offset));
        const key = date.toISOString().slice(0, 10);
        return byDate.get(key) || {
            date: key,
            sessions: [],
            metrics: { sessions: 0, avgDurationSec: 0, completionRate: 0, unansweredRate: 0 }
        };
    });
    const max = Math.max(...points.map((point) => point.metrics.sessions), 1);
    return (
        <div>
            <div className="mb-3 flex items-center justify-between text-xs text-text-muted">
                <span>Günlük oturum sayısı</span>
                <span>En yüksek: {max}</span>
            </div>
            <div className="relative h-52 border-b border-border/80">
                <div className="pointer-events-none absolute inset-0 flex flex-col justify-between text-[10px] text-text-muted/60">
                    <div className="border-t border-dashed border-border/60"><span className="relative -top-2 bg-surface pr-2">{max}</span></div>
                    <div className="border-t border-dashed border-border/40"><span className="relative -top-2 bg-surface pr-2">{Math.ceil(max / 2)}</span></div>
                    <div className="border-t border-border/60"><span className="relative -top-2 bg-surface pr-2">0</span></div>
                </div>
                <div className="absolute inset-x-7 inset-y-0 flex items-end gap-1">
                    {points.map((point, index) => {
                        const value = point.metrics.sessions;
                        const heightPct = value ? Math.max((value / max) * 100, 8) : 1;
                        const dateLabel = new Date(`${point.date}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
                        return (
                            <div key={point.date} className="group relative flex h-full min-w-0 flex-1 items-end">
                                <div
                                    tabIndex={0}
                                    aria-label={`${dateLabel}, ${value} oturum`}
                                    className={`w-full rounded-t-sm transition ${value ? 'bg-brand/70 hover:bg-brand focus:bg-brand' : 'bg-border/30'}`}
                                    style={{ height: `${heightPct}%` }}
                                />
                                <div className={`pointer-events-none absolute bottom-[calc(100%+8px)] z-20 hidden w-64 rounded-xl border border-border bg-bg p-3 text-left shadow-2xl group-hover:block group-focus-within:block ${index > 22 ? 'right-0' : index < 7 ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}>
                                    <p className="font-semibold text-text">{dateLabel}</p>
                                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted">
                                        <span>Oturum</span><span className="text-right text-text">{value}</span>
                                        <span>Ort. süre</span><span className="text-right text-text">{formatDuration(point.metrics.avgDurationSec)}</span>
                                        <span>Tamamlanma</span><span className="text-right text-text">%{Math.round(point.metrics.completionRate * 100)}</span>
                                        <span>Cevapsız</span><span className="text-right text-text">%{Math.round(point.metrics.unansweredRate * 100)}</span>
                                    </div>
                                    {point.sessions.length > 0 && <div className="mt-3 border-t border-border pt-2"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Oturumlar</p>{point.sessions.slice(0, 4).map((session) => <p key={session.id} className="truncate text-xs text-text">{new Date(session.startedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · {session.name} · {formatDuration(session.durationSec)}</p>)}{point.sessions.length > 4 && <p className="mt-1 text-xs text-brand-light">+{point.sessions.length - 4} oturum daha</p>}</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="mt-2 flex justify-between px-7 text-[10px] text-text-muted">
                <span>{new Date(`${points[0].date}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</span>
                <span>{new Date(`${points[14].date}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</span>
                <span>Bugün</span>
            </div>
        </div>
    );
}

function RankedList({ items, valueKey, countKey, emptyLabel }) {
    if (!items?.length) return <p className="text-sm text-text-muted">{emptyLabel}</p>;
    return (
        <ul className="flex flex-col gap-2">
            {items.map((item) => (
                <li key={item[valueKey]} className="flex items-center justify-between gap-4 text-sm">
                    <span className="truncate text-text">{item[valueKey]}</span>
                    <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-muted">
                        {item[countKey]}
                    </span>
                </li>
            ))}
        </ul>
    );
}

export function Analytics() {
    const workspace = useAuthStore((s) => s.workspace);
    const [searchParams, setSearchParams] = useSearchParams();
    const productId = searchParams.get('product') || '';
    const agentId = searchParams.get('agent') || '';

    const { data: products } = useQuery({
        queryKey: ['products', workspace?.id],
        queryFn: () => productsApi.list(workspace.id),
        enabled: !!workspace?.id
    });

    useEffect(() => {
        const resolved = resolveRememberedSelection({ currentId: productId, items: products, storageKey: productSelectionKey(workspace?.id) });
        if (resolved && resolved !== productId) setSearchParams({ product: resolved }, { replace: true });
    }, [productId, products, setSearchParams, workspace?.id]);

    const { data: agents } = useQuery({
        queryKey: ['agents', productId],
        queryFn: () => agentsApi.list(productId),
        enabled: !!productId
    });

    useEffect(() => {
        if (!productId) return;
        const resolved = resolveRememberedSelection({ currentId: agentId, items: agents, storageKey: agentSelectionKey(workspace?.id, productId), getId: (agent) => agent._id });
        if (resolved && resolved !== agentId) setSearchParams({ product: productId, agent: resolved }, { replace: true });
    }, [productId, agentId, agents, setSearchParams, workspace?.id]);

    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['analytics-agent', agentId],
        queryFn: () => analyticsApi.agent(agentId),
        enabled: !!agentId
    });

    const { data: topics, isLoading: topicsLoading } = useQuery({
        queryKey: ['analytics-topics', productId],
        queryFn: () => analyticsApi.productTopics(productId),
        enabled: !!productId
    });

    function onProductChange(value) {
        rememberSelection(productSelectionKey(workspace?.id), value);
        setSearchParams({ product: value });
    }

    function onAgentChange(value) {
        rememberSelection(agentSelectionKey(workspace?.id, productId), value);
        setSearchParams({ product: productId, agent: value });
    }

    return (
        <div>
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-text">Analytics</h1>
                    <p className="mt-1 text-sm text-text-muted">Agent performansı ve konuşma içgörüleri.</p>
                </div>

                {products?.length > 0 && (
                    <div className="flex gap-2">
                        <select
                            value={productId}
                            onChange={(e) => onProductChange(e.target.value)}
                            className="h-10 rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"
                        >
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                        {agents?.length > 0 && (
                            <select
                                value={agentId}
                                onChange={(e) => onAgentChange(e.target.value)}
                                className="h-10 rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"
                            >
                                {agents.map((a) => (
                                    <option key={a._id} value={a._id}>
                                        {a.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                )}
            </div>

            {products?.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <BarChart3 size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Önce bir ürün ve agent oluştur.</p>
                </div>
            )}

            {productId && agents?.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <Bot size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Bu ürün için henüz agent yok.</p>
                </div>
            )}

            {agentId && (
                <>
                    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
                        <KpiCard icon={MessageSquare} label="Toplam Oturum" value={statsLoading ? '—' : stats?.totalSessions ?? 0} />
                        <KpiCard icon={Clock} label="Ort. Süre" value={statsLoading ? '—' : formatDuration(stats?.averageDurationSeconds)} />
                        <KpiCard icon={TrendingUp} label="Tamamlanma" value={statsLoading ? '—' : `%${Math.round((stats?.completionRate || 0) * 100)}`} />
                        <KpiCard icon={AlertTriangle} label="Cevapsız Oran" value={statsLoading ? '—' : `%${Math.round((stats?.unansweredRate || 0) * 100)}`} />
                        <KpiCard icon={Bot} label="Mesaj" value={statsLoading ? '—' : stats?.totalMessages ?? 0} />
                    </div>

                    <div className="mb-6 rounded-[var(--radius-card)] border border-border bg-surface p-5">
                        <h3 className="mb-4 text-sm font-semibold text-text">Son 30 gün — oturum trendi</h3>
                        <SessionsChart dailyActivity={stats?.dailyActivity} />
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                            <h3 className="mb-4 text-sm font-semibold text-text">En çok konuşulan konular</h3>
                            {topicsLoading ? (
                                <p className="text-sm text-text-muted">Yükleniyor…</p>
                            ) : (
                                <RankedList items={topics?.topTopics} valueKey="topic" countKey="count" emptyLabel="Henüz veri yok." />
                            )}
                        </div>

                        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                            <h3 className="mb-4 text-sm font-semibold text-text">Sık itirazlar</h3>
                            {topicsLoading ? (
                                <p className="text-sm text-text-muted">Yükleniyor…</p>
                            ) : (
                                <RankedList items={topics?.topObjections} valueKey="objection" countKey="count" emptyLabel="Henüz veri yok." />
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
