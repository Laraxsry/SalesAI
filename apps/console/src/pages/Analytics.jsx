import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Bot, MessageSquare, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import { analyticsApi, agentsApi, productsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

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

function SessionsChart({ timeSeries }) {
    if (!timeSeries?.length) {
        return <p className="text-sm text-text-muted">Henüz veri yok.</p>;
    }
    const max = Math.max(...timeSeries.map((t) => t.metrics?.sessions || 0), 1);
    return (
        <div className="flex h-40 items-end gap-1">
            {timeSeries.map((t) => {
                const value = t.metrics?.sessions || 0;
                const heightPct = Math.max((value / max) * 100, value > 0 ? 4 : 0);
                return (
                    <div
                        key={t._id || t.bucketAt}
                        title={`${new Date(t.bucketAt).toLocaleString('tr-TR')}: ${value} oturum`}
                        className="min-h-[1px] flex-1 rounded-t bg-brand/60 transition-colors hover:bg-brand"
                        style={{ height: `${heightPct}%` }}
                    />
                );
            })}
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
        if (!productId && products?.[0]) {
            setSearchParams({ product: products[0].id }, { replace: true });
        }
    }, [productId, products, setSearchParams]);

    const { data: agents } = useQuery({
        queryKey: ['agents', productId],
        queryFn: () => agentsApi.list(productId),
        enabled: !!productId
    });

    useEffect(() => {
        if (productId && !agentId && agents?.[0]) {
            setSearchParams({ product: productId, agent: agents[0]._id }, { replace: true });
        }
    }, [productId, agentId, agents, setSearchParams]);

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
        setSearchParams({ product: value });
    }

    function onAgentChange(value) {
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
                        <h3 className="mb-4 text-sm font-semibold text-text">Son 30 gün — saatlik oturum sayısı</h3>
                        <SessionsChart timeSeries={stats?.timeSeries} />
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
