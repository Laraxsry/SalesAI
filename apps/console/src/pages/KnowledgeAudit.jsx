import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, AlertTriangle, Copy, Trash2, ShieldCheck, RefreshCw } from 'lucide-react';
import { knowledgeApi, productsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

/**
 * Knowledge audit review.
 *
 * Every finding is a proposal until someone here approves it. The evidence —
 * the full text of every chunk a finding would retire — is shown next to the
 * proposal on purpose: approving a removal without seeing what disappears is
 * exactly the failure this screen exists to prevent.
 */

const TYPE_META = {
    contradiction: {
        label: 'Çelişki',
        icon: AlertTriangle,
        tone: 'text-red-400 bg-red-500/10',
        help: 'Aynı konuda birbiriyle uyuşmayan bilgiler. Agent müşterilere farklı şeyler söylüyor olabilir.'
    },
    duplicate: {
        label: 'Fazlalık',
        icon: Copy,
        tone: 'text-amber-400 bg-amber-500/10',
        help: 'Aynı bilginin birden fazla kopyası. Biri tutulur, diğerleri emekliye ayrılır.'
    },
    junk: {
        label: 'Çöp',
        icon: Trash2,
        tone: 'text-text-muted bg-surface-raised',
        help: 'Ürün bilgisi taşımayan içerik: menü, çerez bandı, telif satırı.'
    }
};

const RUNNING = new Set(['queued', 'running']);

export function KnowledgeAudit() {
    const workspace = useAuthStore((s) => s.workspace);
    const [searchParams, setSearchParams] = useSearchParams();
    const productId = searchParams.get('product') || '';
    const auditId = searchParams.get('audit') || '';
    const queryClient = useQueryClient();

    /** key -> 'approved' | 'rejected'; findings absent from this map stay pending. */
    const [decisions, setDecisions] = useState({});

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

    const { data: audits } = useQuery({
        queryKey: ['knowledge-audits', productId],
        queryFn: () => knowledgeApi.audits(productId),
        enabled: !!productId,
        // A queued/running audit finishes on the worker, with nothing to push
        // the result here — poll while one is in flight, then stop.
        refetchInterval: (query) =>
            query.state.data?.some((a) => RUNNING.has(a.status)) ? 3000 : false
    });

    const selectedId = auditId || audits?.[0]?.id || '';

    const { data: audit, isLoading } = useQuery({
        queryKey: ['knowledge-audit', selectedId],
        queryFn: () => knowledgeApi.audit(selectedId),
        enabled: !!selectedId,
        refetchInterval: (query) => (RUNNING.has(query.state.data?.status) ? 3000 : false)
    });

    const startAudit = useMutation({
        mutationFn: () => knowledgeApi.startAudit(productId),
        onSuccess: (created) => {
            setDecisions({});
            setSearchParams({ product: productId, audit: created.id });
            queryClient.invalidateQueries({ queryKey: ['knowledge-audits', productId] });
        }
    });

    const applyDecisions = useMutation({
        mutationFn: () =>
            knowledgeApi.applyAudit(selectedId, {
                approvedKeys: Object.keys(decisions).filter((k) => decisions[k] === 'approved'),
                rejectedKeys: Object.keys(decisions).filter((k) => decisions[k] === 'rejected')
            }),
        onSuccess: () => {
            setDecisions({});
            queryClient.invalidateQueries({ queryKey: ['knowledge-audit', selectedId] });
            queryClient.invalidateQueries({ queryKey: ['knowledge-audits', productId] });
        }
    });

    const pending = (audit?.findings || []).filter((f) => f.decision === 'pending');
    const decided = (audit?.findings || []).filter((f) => f.decision !== 'pending');
    const approvedCount = Object.values(decisions).filter((d) => d === 'approved').length;
    const rejectedCount = Object.values(decisions).filter((d) => d === 'rejected').length;
    const isRunning = RUNNING.has(audit?.status);

    return (
        <div>
            <Link
                to={`/knowledge?product=${productId}`}
                className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
            >
                <ArrowLeft size={14} />
                Knowledge
            </Link>

            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-text">Bilgi denetimi</h1>
                    <p className="mt-1 text-sm text-text-muted">
                        Fazlalık, çelişki ve çöp içerik taraması. Hiçbir değişiklik sen onaylamadan uygulanmaz.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {products?.length > 1 && (
                        <select
                            value={productId}
                            onChange={(e) => {
                                setDecisions({});
                                setSearchParams({ product: e.target.value });
                            }}
                            className="h-10 rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"
                        >
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    )}
                    {audits?.length > 0 && (
                        <select
                            value={selectedId}
                            onChange={(e) => {
                                setDecisions({});
                                setSearchParams({ product: productId, audit: e.target.value });
                            }}
                            className="h-10 rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"
                        >
                            {audits.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {new Date(a.createdAt).toLocaleString('tr-TR')} · {a.status}
                                </option>
                            ))}
                        </select>
                    )}
                    <button
                        type="button"
                        onClick={() => startAudit.mutate()}
                        disabled={!productId || startAudit.isPending || isRunning}
                        className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-input)] bg-brand px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={startAudit.isPending || isRunning ? 'animate-spin' : ''} />
                        {isRunning ? 'Taranıyor…' : 'Yeni tarama'}
                    </button>
                </div>
            </div>

            {startAudit.isError && (
                <p className="mb-4 text-sm text-red-400">{startAudit.error?.message || 'Tarama başlatılamadı.'}</p>
            )}

            {audit?.status === 'failed' && (
                <p className="mb-4 rounded-[var(--radius-card)] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    Tarama başarısız: {audit.error}
                </p>
            )}

            {audit?.stats && !isRunning && (
                <p className="mb-6 text-xs text-text-muted">
                    {audit.stats.chunks} chunk tarandı · {audit.stats.clusters} aday küme ·{' '}
                    {audit.stats.llmCalls} LLM çağrısı
                    {audit.stats.chunksTruncated && ' · chunk limiti doldu, tamamı taranmadı'}
                    {audit.stats.clustersTruncated && ' · küme limiti doldu, en güçlü adaylar incelendi'}
                </p>
            )}

            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}
            {isRunning && <p className="text-sm text-text-muted">Tarama sürüyor, sonuçlar hazır olunca burada görünecek…</p>}

            {!isLoading && !isRunning && audit && pending.length === 0 && decided.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <ShieldCheck size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Bu taramada bir sorun bulunmadı.</p>
                </div>
            )}

            {!selectedId && !isLoading && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <ShieldCheck size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Bu ürün için henüz tarama yapılmadı.</p>
                </div>
            )}

            <div className="flex flex-col gap-3">
                {pending.map((finding) => (
                    <FindingCard
                        key={finding.key}
                        finding={finding}
                        decision={decisions[finding.key]}
                        onDecide={(value) =>
                            setDecisions((prev) => {
                                const next = { ...prev };
                                if (next[finding.key] === value) delete next[finding.key];
                                else next[finding.key] = value;
                                return next;
                            })
                        }
                    />
                ))}
            </div>

            {decided.length > 0 && (
                <>
                    <h2 className="mb-3 mt-8 text-sm font-medium text-text-muted">Karar verilmiş bulgular</h2>
                    <div className="flex flex-col gap-3">
                        {decided.map((finding) => (
                            <FindingCard key={finding.key} finding={finding} readOnly />
                        ))}
                    </div>
                </>
            )}

            {/*
             * Fixed to the viewport rather than `sticky bottom-4`: this bar is
             * the last child of the page, so its parent's box ends exactly
             * where the bar does and sticky has no room to stick to — it only
             * showed up once you had scrolled past every finding, which is the
             * opposite of what an action bar is for. The insets clear the w-64
             * sidebar and match <main>'s padding.
             */}
            {(approvedCount > 0 || rejectedCount > 0) && (
                <div className="fixed bottom-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface-raised px-4 py-3 shadow-lg md:left-[calc(16rem+2rem)] md:right-8">
                    <p className="text-sm text-text">
                        {approvedCount} onay · {rejectedCount} ret
                        {approvedCount > 0 && (
                            <span className="ml-2 text-text-muted">
                                Onaylananlar uygulanacak, orijinal chunk'lar silinmez — emekliye ayrılır.
                            </span>
                        )}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setDecisions({})}
                            className="h-9 rounded-[var(--radius-input)] border border-border px-3 text-sm text-text-muted hover:text-text"
                        >
                            Temizle
                        </button>
                        <button
                            type="button"
                            onClick={() => applyDecisions.mutate()}
                            disabled={applyDecisions.isPending}
                            className="h-9 rounded-[var(--radius-input)] bg-brand px-4 text-sm font-medium text-white disabled:opacity-50"
                        >
                            {applyDecisions.isPending ? 'Uygulanıyor…' : 'Uygula'}
                        </button>
                    </div>
                </div>
            )}

            {applyDecisions.isError && (
                <p className="mt-3 text-sm text-red-400">
                    {applyDecisions.error?.message || 'Değişiklikler uygulanamadı.'}
                </p>
            )}
            {applyDecisions.isSuccess && (
                <p className="mt-3 text-sm text-emerald-400">
                    {applyDecisions.data.applied} bulgu uygulandı
                    {applyDecisions.data.curatedChunks > 0 &&
                        ` · ${applyDecisions.data.curatedChunks} düzeltilmiş chunk yazıldı`}
                    {applyDecisions.data.failed > 0 && ` · ${applyDecisions.data.failed} başarısız`}
                </p>
            )}
        </div>
    );
}

function FindingCard({ finding, decision, onDecide, readOnly }) {
    const meta = TYPE_META[finding.type] || TYPE_META.junk;
    const Icon = meta.icon;

    return (
        <div
            className={`rounded-[var(--radius-card)] border bg-surface p-4 ${
                decision === 'approved'
                    ? 'border-brand'
                    : decision === 'rejected'
                      ? 'border-border opacity-60'
                      : 'border-border'
            }`}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
                        <Icon size={14} />
                    </span>
                    <div>
                        <p className="text-sm font-medium text-text">{finding.summary}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                            {meta.label}
                            {typeof finding.similarity === 'number' &&
                                ` · benzerlik ${finding.similarity.toFixed(2)}`}
                            {finding.decision !== 'pending' && ` · ${finding.decision}`}
                        </p>
                    </div>
                </div>

                {!readOnly && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onDecide('rejected')}
                            className={`h-8 rounded-[var(--radius-input)] border px-3 text-xs ${
                                decision === 'rejected'
                                    ? 'border-text-muted text-text'
                                    : 'border-border text-text-muted hover:text-text'
                            }`}
                        >
                            Reddet
                        </button>
                        <button
                            type="button"
                            onClick={() => onDecide('approved')}
                            className={`h-8 rounded-[var(--radius-input)] px-3 text-xs font-medium ${
                                decision === 'approved'
                                    ? 'bg-brand text-white'
                                    : 'border border-border text-text-muted hover:text-text'
                            }`}
                        >
                            Onayla
                        </button>
                    </div>
                )}
            </div>

            {finding.rationale && <p className="mt-3 text-xs text-text-muted">{finding.rationale}</p>}

            {finding.error && <p className="mt-2 text-xs text-red-400">Hata: {finding.error}</p>}

            <div className="mt-3 flex flex-col gap-2">
                {(finding.chunks || []).map((chunk) => {
                    const kept = String(chunk.id) === String(finding.keepChunkId);
                    return (
                        <div
                            key={chunk.id}
                            className={`rounded-[var(--radius-input)] border px-3 py-2 ${
                                kept ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-surface-raised'
                            }`}
                        >
                            <p className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                                {chunk.sourceTitle || 'kaynak yok'}
                                {kept && <span className="ml-2 text-emerald-400">tutulacak</span>}
                                {!kept && finding.type !== 'junk' && (
                                    <span className="ml-2 text-text-muted">emekliye ayrılacak</span>
                                )}
                                {finding.type === 'junk' && (
                                    <span className="ml-2 text-text-muted">aramadan çıkarılacak</span>
                                )}
                            </p>
                            <p className="text-xs leading-relaxed text-text">{chunk.text}</p>
                        </div>
                    );
                })}
            </div>

            {finding.canonicalText && (
                <div className="mt-3 rounded-[var(--radius-input)] border border-brand/40 bg-brand/5 px-3 py-2">
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-brand">Yerine yazılacak metin</p>
                    <p className="text-xs leading-relaxed text-text">{finding.canonicalText}</p>
                </div>
            )}
        </div>
    );
}
