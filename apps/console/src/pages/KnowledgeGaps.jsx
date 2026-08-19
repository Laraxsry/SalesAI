import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    HelpCircle,
    AlertTriangle,
    FileQuestion,
    PlusCircle,
    Sparkles,
    Loader2,
    ChevronDown,
    ChevronUp,
    Download
} from 'lucide-react';
import { analyticsApi, productsApi, knowledgeApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { getSocket } from '../lib/socket.js';

const TABS = [
    { key: 'unanswered', label: 'Cevapsız Sorular' },
    { key: 'analysis', label: 'İçerik Analizi' }
];

const FINDING_META = {
    inconsistency: { label: 'Tutarsızlık', icon: AlertTriangle, className: 'bg-red-500/10 text-red-400' },
    thin: { label: 'Yetersiz detay', icon: FileQuestion, className: 'bg-amber-500/10 text-amber-400' },
    missing: { label: 'Eksik konu', icon: PlusCircle, className: 'bg-blue-500/10 text-blue-400' }
};

const REPORT_STATUS_LABEL = {
    processing: 'Analiz ediliyor…',
    ready: 'Hazır',
    failed: 'Başarısız'
};

function UnansweredQuestionsTab({ productId }) {
    const { data, isLoading } = useQuery({
        queryKey: ['knowledge-gaps', productId],
        queryFn: () => analyticsApi.knowledgeGaps(productId),
        enabled: !!productId
    });

    return (
        <>
            <p className="mb-6 text-sm text-text-muted">
                Agent'ın cevaplayamadığı sorular — buraya içerik ekleyerek boşluğu kapat.
            </p>

            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}

            {!isLoading && data?.gaps?.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <HelpCircle size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Henüz cevapsız kalan soru yok.</p>
                </div>
            )}

            {data?.gaps?.length > 0 && (
                <div className="flex flex-col gap-2">
                    {data.gaps.map((g, i) => (
                        <div
                            key={i}
                            className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3"
                        >
                            <div className="flex items-center gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
                                    <HelpCircle size={14} />
                                </span>
                                <p className="text-sm text-text">{g.question}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-muted">
                                {g.count}×
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}

function FindingGroup({ type, findings, sourceTitleById, onJumpToSource }) {
    if (!findings.length) return null;
    const meta = FINDING_META[type];
    const Icon = meta.icon;

    return (
        <div className="mb-5">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-text">
                <Icon size={14} />
                {meta.label} ({findings.length})
            </h3>
            <div className="flex flex-col gap-2">
                {findings.map((f, i) => (
                    <div key={i} className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
                        <p className="text-sm font-medium text-text">{f.title}</p>
                        <p className="mt-1 text-sm text-text-muted">{f.description}</p>
                        {f.sourceIds?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {f.sourceIds.map((id) => (
                                    <button
                                        key={id}
                                        onClick={() => onJumpToSource(id)}
                                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.className} hover:opacity-80`}
                                    >
                                        {sourceTitleById.get(id) || 'Kaynağa git'}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Bir GAP raporu kartı — accordion (tek seferde bir tane açık) davranışıyla
 * genişletilip daraltılabiliyor, başlık satırında her zaman bir "PDF indir"
 * butonu var (rapor kapalıyken bile) — kullanıcı geçmiş raporları tek tek
 * açmadan da indirebilsin diye.
 */
function ReportCard({ report, isExpanded, onToggle, productName, sourceTitleById, onJumpToSource }) {
    const statusLabel = REPORT_STATUS_LABEL[report.status] || report.status;
    const [generatingPdf, setGeneratingPdf] = useState(false);

    // jsPDF + the embedded Turkish-capable font (~400KB) are only fetched
    // when a PDF is actually requested — dynamic import keeps that weight
    // out of this tab's initial chunk (see gapReportPdf.js).
    async function handleDownloadPdf() {
        setGeneratingPdf(true);
        try {
            const { downloadGapReportPdf } = await import('../lib/gapReportPdf.js');
            downloadGapReportPdf(report, { productName, statusLabel, sourceTitleById });
        } finally {
            setGeneratingPdf(false);
        }
    }

    return (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
                <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    {isExpanded ? (
                        <ChevronUp size={14} className="shrink-0 text-text-muted" />
                    ) : (
                        <ChevronDown size={14} className="shrink-0 text-text-muted" />
                    )}
                    <span className="truncate text-xs font-medium text-text-muted">
                        {new Date(report.createdAt).toLocaleString('tr-TR')} · {statusLabel}
                        {report.status === 'ready' && ` · ${report.findings?.length || 0} bulgu`}
                        {report.truncated && ' · bazı kaynaklar analiz dışı kaldı'}
                    </span>
                </button>
                {report.status !== 'processing' && (
                    <button
                        onClick={handleDownloadPdf}
                        disabled={generatingPdf}
                        title="PDF olarak indir"
                        className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-input)] border border-border px-2 py-1 text-xs text-text-muted hover:text-text disabled:opacity-50"
                    >
                        {generatingPdf ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        PDF
                    </button>
                )}
            </div>

            {isExpanded && (
                <div className="mt-3">
                    {report.status === 'processing' && (
                        <p className="text-sm text-text-muted">
                            <Loader2 size={12} className="mr-1.5 inline animate-spin" />
                            Analiz sürüyor, birazdan hazır olacak…
                        </p>
                    )}
                    {report.status === 'failed' && (
                        <p className="text-sm text-red-400">Analiz başarısız oldu: {report.error || 'bilinmeyen hata'}</p>
                    )}
                    {report.status === 'ready' && report.findings?.length === 0 && (
                        <p className="text-sm text-text-muted">Hiçbir tutarsızlık/eksik bulunamadı — knowledge tabanı sağlam görünüyor.</p>
                    )}
                    {report.status === 'ready' && report.findings?.length > 0 && (
                        <>
                            <FindingGroup
                                type="inconsistency"
                                findings={report.findings.filter((f) => f.type === 'inconsistency')}
                                sourceTitleById={sourceTitleById}
                                onJumpToSource={onJumpToSource}
                            />
                            <FindingGroup
                                type="thin"
                                findings={report.findings.filter((f) => f.type === 'thin')}
                                sourceTitleById={sourceTitleById}
                                onJumpToSource={onJumpToSource}
                            />
                            <FindingGroup
                                type="missing"
                                findings={report.findings.filter((f) => f.type === 'missing')}
                                sourceTitleById={sourceTitleById}
                                onJumpToSource={onJumpToSource}
                            />
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function ContentAnalysisTab({ productId, productName }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [triggerError, setTriggerError] = useState('');
    // null = varsayılan (en yeni rapor açık); '' = kullanıcı hepsini kapattı;
    // aksi halde açık olan raporun id'si — accordion, aynı anda tek rapor açık.
    const [expandedId, setExpandedId] = useState(null);

    const { data: sources } = useQuery({
        queryKey: ['knowledge', productId],
        queryFn: () => knowledgeApi.list(productId),
        enabled: !!productId
    });
    const sourceTitleById = new Map((sources || []).map((s) => [s._id, s.title]));

    const { data: gapData, isLoading } = useQuery({
        queryKey: ['gap-reports', productId],
        queryFn: () => knowledgeApi.gapAnalysis.list(productId),
        enabled: !!productId
    });

    useEffect(() => {
        if (!productId) return;
        const socket = getSocket();
        const onReady = (payload) => {
            if (payload.productId && payload.productId !== productId) return;
            queryClient.invalidateQueries({ queryKey: ['gap-reports', productId] });
        };
        socket.on('gap-report:ready', onReady);
        return () => socket.off('gap-report:ready', onReady);
    }, [productId, queryClient]);

    const triggerMutation = useMutation({
        mutationFn: () => knowledgeApi.gapAnalysis.trigger(productId),
        onSuccess: () => {
            setTriggerError('');
            queryClient.invalidateQueries({ queryKey: ['gap-reports', productId] });
        },
        onError: (err) => setTriggerError(err.message)
    });

    function jumpToSource(sourceId) {
        navigate(`/knowledge?product=${productId}&source=${sourceId}`);
    }

    const reports = gapData?.reports || [];
    const canRequestNow = gapData?.canRequestNow ?? true;

    return (
        <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <p className="max-w-xl text-sm text-text-muted">
                    Bu ürünün tüm knowledge kaynaklarını LLM ile karşılaştırıp aralarındaki tutarsızlıkları,
                    yüzeysel kalmış konuları ve hiç bahsedilmemiş ama beklenen konuları bulur — ziyaretçi
                    trafiği gerekmez.
                </p>
                <button
                    onClick={() => triggerMutation.mutate()}
                    disabled={!canRequestNow || triggerMutation.isPending}
                    title={!canRequestNow ? 'Günlük analiz hakkınız doldu' : undefined}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-input)] bg-brand px-3.5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {triggerMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Analiz Et
                </button>
            </div>

            {triggerError && (
                <p className="mb-4 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {triggerError}
                </p>
            )}

            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}

            {!isLoading && reports.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <Sparkles size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Henüz bir içerik analizi yapılmadı.</p>
                </div>
            )}

            {reports.length > 0 && (
                <div className="flex flex-col gap-2">
                    {reports.map((r) => {
                        const isExpanded = expandedId === null ? r._id === reports[0]._id : expandedId === r._id;
                        return (
                            <ReportCard
                                key={r._id}
                                report={r}
                                isExpanded={isExpanded}
                                onToggle={() => setExpandedId(isExpanded ? '' : r._id)}
                                productName={productName}
                                sourceTitleById={sourceTitleById}
                                onJumpToSource={jumpToSource}
                            />
                        );
                    })}
                </div>
            )}
        </>
    );
}

export function KnowledgeGaps() {
    const workspace = useAuthStore((s) => s.workspace);
    const [searchParams, setSearchParams] = useSearchParams();
    const productId = searchParams.get('product') || '';
    const tab = searchParams.get('tab') || 'unanswered';

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

    function setTab(nextTab) {
        const next = new URLSearchParams(searchParams);
        next.set('tab', nextTab);
        setSearchParams(next);
    }

    return (
        <div>
            <Link
                to={`/knowledge?product=${productId}`}
                className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
            >
                <ArrowLeft size={14} />
                Knowledge
            </Link>

            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <h1 className="text-xl font-semibold text-text">Bilgi boşlukları</h1>

                {products?.length > 1 && (
                    <select
                        value={productId}
                        onChange={(e) => {
                            const next = new URLSearchParams(searchParams);
                            next.set('product', e.target.value);
                            setSearchParams(next);
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
            </div>

            <div className="mb-6 flex gap-1 border-b border-border">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                            tab === t.key
                                ? 'border-brand text-text'
                                : 'border-transparent text-text-muted hover:text-text'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'unanswered' && <UnansweredQuestionsTab productId={productId} />}
            {tab === 'analysis' && (
                <ContentAnalysisTab
                    productId={productId}
                    productName={products?.find((p) => p.id === productId)?.name}
                />
            )}
        </div>
    );
}
