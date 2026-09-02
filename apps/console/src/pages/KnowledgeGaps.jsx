import { useEffect, useMemo, useState } from 'react';
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
    Download,
    Check,
    FolderTree
} from 'lucide-react';
import { analyticsApi, productsApi, knowledgeApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { getSocket } from '../lib/socket.js';

const TABS = [
    { key: 'unanswered', label: 'Cevapsız Sorular' },
    { key: 'analysis', label: 'İçerik Analizi' },
    { key: 'site', label: 'Site Bilgisi' }
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
    const meta = FINDING_META[type];
    const Icon = meta.icon;

    if (!findings.length) {
        return (
            <div className="mb-5">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-text">
                    <Icon size={14} />
                    {meta.label}
                </h3>
                <p className="flex items-center gap-1.5 text-sm text-text-muted">
                    <Check size={14} className="text-emerald-400" />
                    Bulunamadı — bu kategori kontrol edildi.
                </p>
            </div>
        );
    }

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
                    {report.status === 'ready' && (
                        <>
                            <FindingGroup
                                type="inconsistency"
                                findings={(report.findings || []).filter((f) => f.type === 'inconsistency')}
                                sourceTitleById={sourceTitleById}
                                onJumpToSource={onJumpToSource}
                            />
                            <FindingGroup
                                type="thin"
                                findings={(report.findings || []).filter((f) => f.type === 'thin')}
                                sourceTitleById={sourceTitleById}
                                onJumpToSource={onJumpToSource}
                            />
                            <FindingGroup
                                type="missing"
                                findings={(report.findings || []).filter((f) => f.type === 'missing')}
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

/** Best-effort short label for a page URL (falls back to the raw string for an unparsable one). */
function pagePath(url) {
    try {
        return new URL(url).pathname || '/';
    } catch {
        return url;
    }
}

/**
 * One node of the Konu Ağacı (KnowledgeTopic tree) — recursive, renders its
 * own children when expanded. Inline markdown edit (no separate modal, these
 * documents are meant to be read/tweaked in place) saves via `onSave`, which
 * re-embeds the topic's chunks server-side (`PATCH /knowledge/topics/:id`).
 */
function TopicNode({ topic, childrenByParent, depth, expandedIds, onToggle, onJumpToSource, onSave }) {
    const kids = childrenByParent.get(topic._id) || [];
    const isExpanded = expandedIds.has(topic._id);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(topic.body || '');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!editing) setDraft(topic.body || '');
    }, [topic.body, editing]);

    async function handleSave() {
        setSaving(true);
        try {
            await onSave(topic._id, draft);
            setEditing(false);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={{ marginLeft: depth * 20 }}>
            <button
                onClick={() => onToggle(topic._id)}
                className="flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2 text-left hover:border-brand/50"
            >
                {isExpanded ? (
                    <ChevronUp size={14} className="shrink-0 text-text-muted" />
                ) : (
                    <ChevronDown size={14} className="shrink-0 text-text-muted" />
                )}
                <span className="truncate text-sm font-medium text-text">{topic.title}</span>
                {topic.autoGenerated && (
                    <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        otomatik oluşturuldu
                    </span>
                )}
                {!topic.body && (
                    <span className="shrink-0 text-xs text-text-muted">içerik bulunamadı</span>
                )}
            </button>

            {isExpanded && (
                <div className="mb-2 mt-1.5 rounded-[var(--radius-card)] border border-border bg-surface-raised p-3">
                    {editing ? (
                        <>
                            <textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                rows={10}
                                className="w-full rounded-[var(--radius-input)] border border-border bg-surface p-2 text-sm text-text outline-none focus:border-brand"
                            />
                            <div className="mt-2 flex justify-end gap-3">
                                <button
                                    onClick={() => {
                                        setEditing(false);
                                        setDraft(topic.body || '');
                                    }}
                                    className="text-xs text-text-muted hover:text-text"
                                >
                                    Vazgeç
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="rounded-[var(--radius-input)] bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                                >
                                    {saving ? 'Kaydediliyor…' : 'Kaydet'}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="whitespace-pre-wrap text-sm text-text-muted">
                                {topic.body || 'Bu konu için henüz içerik bulunamadı — site taramasında hiçbir sayfa bu başlığa katkı sağlamadı.'}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {(topic.sourcePages || []).slice(0, 8).map((sp, i) => (
                                        <button
                                            key={i}
                                            onClick={() => onJumpToSource(sp.sourceId)}
                                            title={sp.pageUrl}
                                            className="rounded-full bg-surface px-2 py-1 text-[11px] text-text-muted hover:text-text"
                                        >
                                            {pagePath(sp.pageUrl)}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setEditing(true)}
                                    className="shrink-0 text-xs font-medium text-brand hover:underline"
                                >
                                    Düzenle
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {isExpanded &&
                kids.map((k) => (
                    <TopicNode
                        key={k._id}
                        topic={k}
                        childrenByParent={childrenByParent}
                        depth={depth + 1}
                        expandedIds={expandedIds}
                        onToggle={onToggle}
                        onJumpToSource={onJumpToSource}
                        onSave={onSave}
                    />
                ))}
        </div>
    );
}

/**
 * Site Bilgisi sekmesi — Konu Ağacı (yukarıdaki, düzenlenebilir) + Site
 * Yapısı (aşağıda, salt-okunur — sayfa/buton haritası, sadece istenince
 * yüklenir). `apps/worker-ingestion/src/handlers/ingest-source.js`'in
 * `runSiteTopicsPass()`'ının doldurduğu veriyi gösterir.
 */
function SiteTopicsTab({ productId }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [expandedIds, setExpandedIds] = useState(() => new Set());
    const [showSitemap, setShowSitemap] = useState(false);
    const [expandedPageUrls, setExpandedPageUrls] = useState(() => new Set());

    const { data: topics, isLoading } = useQuery({
        queryKey: ['knowledge-topics', productId],
        queryFn: () => knowledgeApi.topics.list(productId),
        enabled: !!productId
    });

    const { data: sitemapData, isLoading: sitemapLoading } = useQuery({
        queryKey: ['knowledge-sitemap', productId],
        queryFn: () => knowledgeApi.sitemap(productId),
        enabled: !!productId && showSitemap
    });

    function toggle(id) {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function handleSaveTopic(id, body) {
        await knowledgeApi.topics.update(id, { body });
        queryClient.invalidateQueries({ queryKey: ['knowledge-topics', productId] });
    }

    function jumpToSource(sourceId) {
        navigate(`/knowledge?product=${productId}&source=${sourceId}`);
    }

    function togglePageComponents(url) {
        setExpandedPageUrls((prev) => {
            const next = new Set(prev);
            if (next.has(url)) next.delete(url);
            else next.add(url);
            return next;
        });
    }

    const { roots, childrenByParent } = useMemo(() => {
        const childrenByParent = new Map();
        const roots = [];
        for (const t of topics || []) {
            if (t.parentTopicId) {
                const list = childrenByParent.get(t.parentTopicId) || [];
                list.push(t);
                childrenByParent.set(t.parentTopicId, list);
            } else {
                roots.push(t);
            }
        }
        return { roots, childrenByParent };
    }, [topics]);

    return (
        <>
            <p className="mb-6 max-w-2xl text-sm text-text-muted">
                Site taranırken agent, sitenizdeki içerikleri (İletişim, Fiyatlandırma, SSS gibi) konu
                başlıklarına göre kendiliğinden topluyor — her başlık, o konuyla ilgili TÜM sayfalardan
                birleştirilmiş, düzenlenebilir bir doküman. Bir URL kaynağını her yeniden taradığınızda
                güncellenir.
            </p>

            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}

            {!isLoading && roots.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <FolderTree size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">
                        Henüz konu ağacı oluşturulmadı — bir URL kaynağı tarandığında otomatik oluşur.
                    </p>
                </div>
            )}

            {roots.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    {roots.map((t) => (
                        <TopicNode
                            key={t._id}
                            topic={t}
                            childrenByParent={childrenByParent}
                            depth={0}
                            expandedIds={expandedIds}
                            onToggle={toggle}
                            onJumpToSource={jumpToSource}
                            onSave={handleSaveTopic}
                        />
                    ))}
                </div>
            )}

            <div className="mt-8 border-t border-border pt-6">
                <button
                    onClick={() => setShowSitemap((v) => !v)}
                    className="flex items-center gap-1.5 text-sm font-medium text-text hover:text-brand"
                >
                    {showSitemap ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Site Yapısı (sayfa/buton haritası)
                </button>
                {showSitemap && (
                    <div className="mt-3 flex flex-col gap-1.5">
                        {sitemapLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}
                        {!sitemapLoading && sitemapData?.pages?.length === 0 && (
                            <p className="text-sm text-text-muted">Site haritası bulunamadı.</p>
                        )}
                        {sitemapData?.pages?.map((p, i) => {
                            const headings = p.components?.headings || [];
                            const elements = p.components?.interactiveElements || [];
                            const sections = p.components?.sections || [];
                            const hasComponents = headings.length > 0 || elements.length > 0 || sections.length > 0;
                            const pageExpanded = expandedPageUrls.has(p.url);
                            return (
                                <div key={i} className="rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2 text-xs">
                                    <p className="truncate font-medium text-text">{p.url}</p>
                                    {p.parentUrl && <p className="mt-0.5 truncate text-text-muted">↳ {p.parentUrl}</p>}
                                    {p.links?.length > 0 && (
                                        <p className="mt-1 text-text-muted">{p.links.length} link/buton</p>
                                    )}
                                    {hasComponents && (
                                        <button
                                            type="button"
                                            onClick={() => togglePageComponents(p.url)}
                                            className="mt-1 flex items-center gap-1 text-text-muted hover:text-brand"
                                        >
                                            {pageExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                            {elements.length} sayfa-içi öğe, {headings.length} başlık
                                            {sections.length > 0 && `, ${sections.length} bölüm`}
                                        </button>
                                    )}
                                    {pageExpanded && (
                                        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                                            {headings.length > 0 && (
                                                <p className="text-text-muted">
                                                    <span className="font-medium text-text">Başlıklar:</span>{' '}
                                                    {headings.map((h) => h.text).join(' · ')}
                                                </p>
                                            )}
                                            {elements.length > 0 && (
                                                <p className="text-text-muted">
                                                    <span className="font-medium text-text">Butonlar/linkler:</span>{' '}
                                                    {elements.map((el) => el.label).join(' · ')}
                                                </p>
                                            )}
                                            {sections.length > 0 && (
                                                <p className="text-text-muted">
                                                    <span className="font-medium text-text">Bölümler:</span>{' '}
                                                    {sections.map((s) => s.ariaLabel || s.tag).join(' · ')}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
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
            {tab === 'site' && <SiteTopicsTab productId={productId} />}
        </div>
    );
}
