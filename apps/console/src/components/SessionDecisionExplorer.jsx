import {
    AlertTriangle, Bot, Check, ChevronRight, Circle, Clock3, GitBranch,
    Layers3, MonitorPlay, ShieldCheck, Sparkles, X
} from 'lucide-react';
import { routeDiff } from '../lib/sessionDecisionTraceView.js';

const NODE_STATUS = {
    completed: { label: 'Tamamlandı', style: 'bg-emerald-500/10 text-emerald-300', icon: Check },
    active: { label: 'Çalıştırıldı', style: 'bg-cyan-500/10 text-cyan-300', icon: Sparkles },
    failed: { label: 'Başarısız', style: 'bg-red-500/10 text-red-300', icon: X },
    deferred: { label: 'Ertelendi', style: 'bg-amber-500/10 text-amber-300', icon: Clock3 },
    interrupted: { label: 'Müşteri kesti', style: 'bg-violet-500/10 text-violet-300', icon: AlertTriangle },
    pending: { label: 'Bekliyor', style: 'bg-surface-raised text-text-muted', icon: Circle }
};

const NODE_TYPE_LABEL = {
    answer: 'Doğrudan yanıt', demo: 'Canlı demo', ask: 'Soru', check: 'Kontrol',
    obligation: 'Zorunlu hedef', handoff: 'Aktarım', narrative: 'Anlatım', important: 'Önemli anlatım',
    situational: 'Esnek anlatım'
};

const REVIEWER_LABEL = {
    grounding: 'Kaynak doğrulama', repetition: 'Tekrar kontrolü', sales_balance: 'Görüşme dengesi',
    model_critic: 'LLM eleştirmeni', validator: 'Deterministik validator'
};

const ANALYST_LABEL = {
    participant_memory: 'Katılımcı hafızası', follow_up_classification: 'Takip sınıflandırması',
    route_critic: 'Rota eleştirmeni'
};

function StatusBadge({ status }) {
    const config = NODE_STATUS[status] || NODE_STATUS.pending;
    const Icon = config.icon;
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${config.style}`}>
            <Icon size={11} /> {config.label}
        </span>
    );
}

function CohortBadge({ cohort }) {
    const styles = {
        canary: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
        shadow: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
        control: 'border-border bg-surface-raised text-text-muted'
    };
    return (
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${styles[cohort] || styles.control}`}>
            {cohort}
        </span>
    );
}

function EmptyTrace() {
    return (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center">
            <GitBranch size={28} className="mb-3 text-text-muted" />
            <h3 className="text-sm font-medium text-text">Bu oturumda karar izi yok</h3>
            <p className="mt-1 max-w-sm text-xs leading-5 text-text-muted">
                Oturum eski olabilir veya dinamik playbook bu görüşmede etkinleşmemiş olabilir.
            </p>
        </div>
    );
}

export function DecisionSummary({ trace }) {
    const summary = trace?.summary;
    if (!trace || !summary) return null;
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-brand/25 bg-brand/5 px-4 py-3">
            <CohortBadge cohort={trace.cohort} />
            <span className="text-sm font-medium text-text">Revision {trace.activeRevision} aktif</span>
            <span className="text-text-muted">·</span>
            <span className="text-xs text-text-muted">
                {summary.completedNodeCount}/{summary.nodeCount} hedef tamamlandı
            </span>
            {summary.failedNodeCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-red-300">
                    <AlertTriangle size={12} /> {summary.failedNodeCount} sorun
                </span>
            )}
        </div>
    );
}

export function RouteExplorer({ trace, selectedRevision, onRevisionChange }) {
    if (!trace?.playbookActive || trace.revisions.length === 0) return <EmptyTrace />;
    const revision = trace.revisions.find((item) => item.revision === selectedRevision)
        || trace.revisions.at(-1);
    const diff = routeDiff(revision, trace.revisions);
    const removedNodes = (trace.revisions.find((item) => item.revision === revision.baseRevision)?.nodes || [])
        .filter((node) => diff.removed.includes(node.id));

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <GitBranch size={17} className="text-brand-light" />
                        <h3 className="text-sm font-semibold text-text">Görüşme karar rotası</h3>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                        {revision.reason === 'initial_playbook' ? 'İlk şirket planı' : `Değişim nedeni: ${revision.reason}`}
                    </p>
                </div>
                <label className="text-xs text-text-muted">
                    Revision
                    <select
                        value={revision.revision}
                        onChange={(event) => onRevisionChange(Number(event.target.value))}
                        className="ml-2 rounded-lg border border-input-border bg-input-bg px-3 py-2 text-xs text-text"
                    >
                        {trace.revisions.map((item) => (
                            <option key={item.revision} value={item.revision}>
                                {item.revision === 0 ? '0 · İlk rota' : `${item.revision} · ${item.status === 'proposed_shadow' ? 'Shadow önerisi' : 'Kabul edildi'}`}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {revision.revision > 0 && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full bg-cyan-500/10 px-2 py-1 text-cyan-300">+{diff.added.length} eklendi</span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">{diff.retained.length} korundu</span>
                    <span className="rounded-full bg-red-500/10 px-2 py-1 text-red-300">−{diff.removed.length} kaldırıldı</span>
                    {revision.status === 'proposed_shadow' && (
                        <span className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-300">Müşteriye uygulanmadı</span>
                    )}
                </div>
            )}

            <div className="relative space-y-3 before:absolute before:bottom-6 before:left-5 before:top-6 before:w-px before:bg-border">
                {revision.nodes.map((node, index) => {
                    const added = diff.added.includes(node.id) && revision.revision > 0;
                    return (
                        <article key={node.id} className={`relative rounded-[var(--radius-card)] border p-4 pl-12 ${added ? 'border-cyan-400/30 bg-cyan-400/5' : 'border-border bg-surface'}`}>
                            <span className="absolute left-2.5 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg text-xs font-semibold text-brand-light">
                                {index + 1}
                            </span>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-light">
                                            {NODE_TYPE_LABEL[node.type] || node.type}
                                        </span>
                                        {added && <span className="text-[10px] font-medium text-cyan-300">YENİ</span>}
                                        {node.requirement === 'required_before_close' && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-300">
                                                <ShieldCheck size={11} /> Kapanış yükümlülüğü
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-sm leading-6 text-text">
                                        {node.objective || 'Bu eski kayıtta node açıklaması bulunmuyor.'}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                                        {node.evidenceCount > 0 && <span>{node.evidenceCount} doğrulanmış kaynak</span>}
                                        {node.page && <span className="inline-flex items-center gap-1"><MonitorPlay size={11} /> {node.page}</span>}
                                        {node.demoStatus && <span>Demo: {node.demoStatus}</span>}
                                    </div>
                                    {node.evidenceRefs?.length > 0 && (
                                        <details className="mt-2 text-[11px] text-text-muted">
                                            <summary className="cursor-pointer hover:text-text">Kaynak referanslarını göster</summary>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {node.evidenceRefs.map((reference) => (
                                                    <span key={reference} className="rounded-md bg-surface-raised px-1.5 py-0.5">{reference}</span>
                                                ))}
                                            </div>
                                        </details>
                                    )}
                                </div>
                                <StatusBadge status={node.status} />
                            </div>
                        </article>
                    );
                })}
            </div>

            {removedNodes.length > 0 && (
                <details className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
                    <summary className="cursor-pointer text-xs font-medium text-text-muted">Bu revision’da kaldırılan hedefler ({removedNodes.length})</summary>
                    <div className="mt-3 space-y-2">
                        {removedNodes.map((node) => (
                            <div key={node.id} className="flex items-center gap-2 text-xs text-text-muted line-through">
                                <X size={12} className="text-red-300" /> {node.objective || node.id}
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {revision.reviews.length > 0 && (
                <details className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
                    <summary className="cursor-pointer text-sm font-medium text-text">
                        Güvenlik ve kalite kontrolleri · {revision.reviews.filter((item) => item.status === 'passed').length}/{revision.reviews.length} doğrudan geçti
                    </summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {revision.reviews.map((review) => (
                            <div key={`${review.seq}-${review.reviewerId}`} className="flex items-center justify-between rounded-xl bg-bg-muted p-3">
                                <span className="text-xs text-text">{REVIEWER_LABEL[review.reviewerId] || review.reviewerId}</span>
                                <span className={`text-[11px] font-medium ${review.status === 'passed' ? 'text-emerald-300' : 'text-amber-300'}`}>
                                    {review.status === 'accepted' ? 'kabul edildi' : review.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {trace.decisions.some((decision) => decision.status !== 'started') && (
                <details className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
                    <summary className="cursor-pointer text-sm font-medium text-text">Rota karar geçmişi</summary>
                    <div className="mt-3 space-y-2">
                        {trace.decisions.filter((decision) => decision.status !== 'started').map((decision) => (
                            <div key={decision.seq} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bg-muted p-3">
                                <div>
                                    <p className="text-xs font-medium text-text">{decision.reason}</p>
                                    <p className="mt-0.5 text-[11px] text-text-muted">
                                        Revision {decision.baseRevision ?? '—'} → {decision.resultingRevision ?? 'değişmedi'} · {decision.proposedNodeCount} aday node
                                    </p>
                                </div>
                                <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${decision.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                                    {decision.status === 'accepted' ? 'Kabul edildi' : decision.status === 'rejected' ? 'Reddedildi' : 'Yok sayıldı'}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

export function AnalystExplorer({ trace }) {
    if (!trace?.analysts?.length) {
        return (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center">
                <Bot size={28} className="mb-3 text-text-muted" />
                <p className="text-sm text-text">Bu oturumda uzman sonucu kaydedilmedi.</p>
                <p className="mt-1 text-xs text-text-muted">Control veya eski oturumlarda bu normaldir.</p>
            </div>
        );
    }
    return (
        <div className="space-y-3">
            <div className="rounded-[var(--radius-card)] border border-brand/20 bg-brand/5 p-4">
                <div className="flex items-center gap-2"><Layers3 size={17} className="text-brand-light" /><h3 className="text-sm font-semibold text-text">Arka plan uzmanları</h3></div>
                <p className="mt-1 text-xs leading-5 text-text-muted">Bu işlemler ana konuşmayı bekletmeden çalışır; yalnız doğrulanmış sonuçlar görüşme hafızasına uygulanabilir.</p>
            </div>
            {trace.analysts.map((analyst) => (
                <div key={`${analyst.seq}-${analyst.analystId}`} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-light"><Bot size={17} /></span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text">{ANALYST_LABEL[analyst.analystId] || analyst.analystId}</p>
                        <p className="mt-0.5 text-xs text-text-muted">{analyst.proposalType || 'Analiz'}{analyst.reason ? ` · ${analyst.reason}` : ''}</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${analyst.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-surface-raised text-text-muted'}`}>{analyst.status}</span>
                </div>
            ))}
        </div>
    );
}

export function TechnicalTimeline({ trace }) {
    if (!trace?.technical?.length) return <EmptyTrace />;
    return (
        <div className="space-y-2">
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-bg-muted p-3 text-xs leading-5 text-text-muted">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-light" />
                Güvenli teknik özet gösteriliyor. Ham model düşüncesi, müşteri verileri, form değerleri ve araç argümanları burada yer almaz.
            </div>
            {trace.technical.map((event) => (
                <div key={`${event.seq}-${event.type}`} className="flex gap-3 rounded-xl border border-border/70 bg-surface px-3 py-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-text-muted"><Clock3 size={12} /></span>
                    <div className="min-w-0 flex-1">
                        <p className="break-all text-xs font-medium text-text">{event.type}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-text-muted">
                            <span>#{event.seq}</span>
                            {event.status && <span>{event.status}</span>}
                            {event.nodeId && <span>node: {event.nodeId}</span>}
                            {event.revision !== null && <span>rev: {event.revision}</span>}
                            {event.durationMs !== null && <span>{event.durationMs} ms</span>}
                        </div>
                    </div>
                    <ChevronRight size={14} className="mt-1 shrink-0 text-text-muted" />
                </div>
            ))}
        </div>
    );
}
