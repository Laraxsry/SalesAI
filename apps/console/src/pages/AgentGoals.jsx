import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui';
import { isTourNavigableUrl } from '@repo/contracts';
import { ArrowLeft, Globe, Paperclip, Trash2, Target, Info, AlertCircle, Check, GripVertical, Sparkles } from 'lucide-react';
import { agentsApi } from '../lib/api.js';
import { toEditorSurvey } from '../lib/playbookSurvey.js';

/**
 * Hedefler (playbook) editörü — agent'ın her ziyaretçide izleyeceği genel
 * güzergah. Numaralı liste: son satır her zaman boş bekler, ona yazılınca
 * altına yenisi açılır.
 *
 * İlk satır dolu gelir: selamlama böylece kodda özel bir durum olmadan
 * sıradaki ilk hedef olur — bkz. GET /agents/:id/playbook, "Faz sırası"
 * bölümü.
 */

const MODE_OPTIONS = [
    { value: 'situational', label: 'Duruma göre' },
    { value: 'important', label: 'Zorunlu' },
    { value: 'skip-if-no-answer', label: 'Cevap yoksa geç' }
];

const NODE_TYPE_OPTIONS = [
    { value: 'narrative', label: 'Anlatım' },
    { value: 'survey', label: 'Soru' }
];

function makeRowId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `row-${Math.random().toString(36).slice(2)}`;
}

function makeOptionValue() {
    return `option_${makeRowId().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`;
}

function makeOption(label) {
    return { value: makeOptionValue(), label };
}

/** Trailing-empty-slot pattern, same as rows: the last option box is always
 *  an empty one to type into, capped at the server's 8-option limit. */
function withTrailingEmptyOption(options) {
    const last = options[options.length - 1];
    if (options.length >= 8) return options;
    if (!last || last.label.trim()) return [...options, makeOption('')];
    return options;
}

function optionPlaceholderIndex(options) {
    const last = options[options.length - 1];
    return last && !last.label.trim() ? options.length - 1 : -1;
}

/** Same trailing-empty-slot pattern as options, for the plain-string actions
 *  list — capped at the server's 10-action limit. */
function withTrailingEmptyAction(actions) {
    const last = actions[actions.length - 1];
    if (actions.length >= 10) return actions;
    if (last === undefined || last.trim()) return [...actions, ''];
    return actions;
}

function actionPlaceholderIndex(actions) {
    const last = actions[actions.length - 1];
    return last !== undefined && !last.trim() ? actions.length - 1 : -1;
}

function emptyRow() {
    return { id: makeRowId(), type: 'narrative', directive: '', url: null, actions: null, mode: 'situational', survey: null };
}

function rowText(row) {
    return row.type === 'survey' ? row.survey?.question || '' : row.directive || '';
}

/** Server nodes -> editor rows, with the first-step seed and a trailing
 *  empty row always guaranteed. */
function rowsFromServer(nodes) {
    const rows = (nodes || []).map((n) => ({
        id: n.id || makeRowId(),
        type: n.type || 'narrative',
        directive: n.directive || '',
        url: n.url ?? null,
        actions: n.actions?.length ? withTrailingEmptyAction(n.actions) : null,
        mode: n.mode || 'situational',
        survey: n.type === 'survey' && n.survey
            ? toEditorSurvey(
                  n.survey,
                  n.survey.answerType === 'text'
                      ? []
                      : withTrailingEmptyOption((n.survey.options || []).map((option) => ({
                            value: option.value,
                            label: option.label
                        })))
              )
            : null
    }));

    if (rows.length === 0) {
        rows.push({ ...emptyRow(), directive: 'Kullanıcıya kısaca ürünü özetle' });
    }

    const last = rows[rows.length - 1];
    if (!last || rowText(last).trim()) rows.push(emptyRow());
    return rows;
}

export function AgentGoals() {
    const { id } = useParams();
    const queryClient = useQueryClient();
    const [rows, setRows] = useState([]);
    const [hydrated, setHydrated] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [creationMode, setCreationMode] = useState('custom');
    const [generationBrief, setGenerationBrief] = useState('');
    const [generationStrategy, setGenerationStrategy] = useState('consultative');
    const [generationPreset, setGenerationPreset] = useState('guided-demo');
    const [includeSurvey, setIncludeSurvey] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [generatedDraft, setGeneratedDraft] = useState(null);

    const { data, isLoading } = useQuery({
        queryKey: ['agent-playbook', id],
        queryFn: () => agentsApi.getPlaybook(id)
    });

    // ── Drag-to-reorder ─────────────────────────────────────────────────
    // Native HTML5 DnD (no added dependency) + a small manual FLIP so the
    // rows that shift out of the way animate instead of jumping. The drag
    // is only ever started from the grip handle (draggable lives there, not
    // on the row), and its native ghost image is swapped for the whole row
    // via setDragImage so it still looks like the row itself is lifted.
    const rowRefs = useRef(new Map());
    const prevRectsRef = useRef(null);
    const [draggingId, setDraggingId] = useState(null);
    const [draggingOption, setDraggingOption] = useState(null);

    // Runs after every rows update; only actually animates when a reorder
    // (not a text edit) primed prevRectsRef right before the state change.
    useLayoutEffect(() => {
        const prevRects = prevRectsRef.current;
        if (!prevRects) return;
        prevRectsRef.current = null;
        rowRefs.current.forEach((el, rowId) => {
            if (!el) return;
            const before = prevRects.get(rowId);
            if (!before) return;
            const after = el.getBoundingClientRect();
            const deltaY = before.top - after.top;
            if (Math.abs(deltaY) < 0.5) return;
            el.style.transition = 'none';
            el.style.transform = `translateY(${deltaY}px)`;
            el.getBoundingClientRect(); // force reflow before re-enabling the transition
            requestAnimationFrame(() => {
                el.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0, 1)';
                el.style.transform = '';
            });
        });
    }, [rows]);

    function captureRowRects() {
        const map = new Map();
        rowRefs.current.forEach((el, rowId) => {
            if (el) map.set(rowId, el.getBoundingClientRect());
        });
        prevRectsRef.current = map;
    }

    /** The trailing empty row always stays last — it's the "type here to add
     *  a step" slot, not a real step to reorder around. */
    function placeholderIndex(list) {
        const last = list[list.length - 1];
        return last && !rowText(last).trim() ? list.length - 1 : -1;
    }

    function moveRow(rowId, targetIndex) {
        setRows((prev) => {
            const fromIndex = prev.findIndex((r) => r.id === rowId);
            const clampedTarget = Math.min(targetIndex, prev.length - 1);
            if (fromIndex === -1 || fromIndex === clampedTarget) return prev;
            const next = [...prev];
            const [item] = next.splice(fromIndex, 1);
            const insertAt = fromIndex < clampedTarget ? clampedTarget - 1 : clampedTarget;
            next.splice(insertAt, 0, item);
            return next;
        });
        setSaved(false);
    }

    function handleGripDragStart(e, row) {
        setDraggingId(row.id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.id);
        const rowEl = rowRefs.current.get(row.id);
        if (rowEl) {
            const rect = rowEl.getBoundingClientRect();
            e.dataTransfer.setDragImage(rowEl, e.clientX - rect.left, e.clientY - rect.top);
        }
    }

    function handleRowDragOver(e, index) {
        if (!draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const isAfter = e.clientY - rect.top > rect.height / 2;
        let targetIndex = isAfter ? index + 1 : index;
        const pIndex = placeholderIndex(rows);
        if (pIndex !== -1) targetIndex = Math.min(targetIndex, pIndex);
        const currentIndex = rows.findIndex((r) => r.id === draggingId);
        if (targetIndex === currentIndex) return;
        captureRowRects();
        moveRow(draggingId, targetIndex);
    }

    /** Keyboard equivalent of the drag: swaps with the adjacent row rather
     *  than going through moveRow's insertion-gap math, whose "-1 when
     *  moving forward" adjustment is meant for drop points further down the
     *  list — for a single adjacent step it cancels itself out and produces
     *  no move at all. */
    function handleGripKeyDown(e, row, index) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const pIndex = placeholderIndex(rows);
        const maxIndex = pIndex !== -1 ? pIndex : rows.length - 1;
        const targetIndex = e.key === 'ArrowUp' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex > maxIndex) return;
        captureRowRects();
        setRows((prev) => {
            const next = [...prev];
            [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
            return next;
        });
        setSaved(false);
    }

    function endDrag() {
        setDraggingId(null);
    }

    // Hydrate once from the server, then leave local edits alone — a
    // background refetch (e.g. React Query revalidating on focus) must never
    // clobber what the marketer is mid-typing.
    useEffect(() => {
        if (data && !hydrated) {
            setRows(rowsFromServer(data.nodes));
            setHydrated(true);
        }
    }, [data, hydrated]);

    const product = data?.product || {};

    useEffect(() => {
        if (Number(data?.maxParticipants) > 1) setIncludeSurvey(false);
    }, [data?.maxParticipants]);

    function withTrailingEmpty(next) {
        const last = next[next.length - 1];
        if (!last || rowText(last).trim()) return [...next, emptyRow()];
        return next;
    }

    function updateRow(rowId, patch) {
        setSaved(false);
        setRows((prev) => withTrailingEmpty(prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r))));
    }

    function removeRow(rowId) {
        setSaved(false);
        setRows((prev) => {
            const next = prev.filter((r) => r.id !== rowId);
            return withTrailingEmpty(next.length ? next : []);
        });
    }

    /** URL alanını aç/kapat: null = kapalı, '' = açık ve boş. */
    function toggleUrl(row) {
        updateRow(row.id, { url: row.url === null ? '' : null });
    }

    /** Aksiyon listesini aç/kapat, aynı kalıp — açılınca tek boş satırla başlar. */
    function toggleActions(row) {
        updateRow(row.id, { actions: row.actions === null ? [''] : null });
    }

    function updateActionText(row, index, value) {
        updateRow(row.id, {
            actions: withTrailingEmptyAction(row.actions.map((a, i) => (i === index ? value : a)))
        });
    }

    function removeAction(row, index) {
        updateRow(row.id, {
            actions: withTrailingEmptyAction(row.actions.filter((_, i) => i !== index))
        });
    }

    function changeNodeType(row, type) {
        if (type === 'survey' && Number(data?.maxParticipants) > 1) return;
        if (type === 'survey') {
            updateRow(row.id, {
                type,
                survey: {
                    question: row.directive || '',
                    fieldKey: null,
                    answerType: 'single-choice',
                    options: withTrailingEmptyOption([]),
                    allowFreeText: false,
                    required: true
                }
            });
            return;
        }
        updateRow(row.id, {
            type,
            directive: row.survey?.question || row.directive || '',
            survey: null
        });
    }

    function updateOptionLabel(row, index, label) {
        updateRow(row.id, {
            survey: {
                ...row.survey,
                options: withTrailingEmptyOption(
                    row.survey.options.map((o, i) => (i === index ? { ...o, label } : o))
                )
            }
        });
    }

    function removeOption(row, index) {
        updateRow(row.id, {
            survey: {
                ...row.survey,
                options: withTrailingEmptyOption(row.survey.options.filter((_, i) => i !== index))
            }
        });
    }

    function handleOptionDragStart(e, row, index) {
        setDraggingOption({ rowId: row.id, index });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
    }

    /** Live-swaps as the pointer passes over another option box — small,
     *  short lists (≤8) don't need the row list's FLIP animation. */
    function handleOptionDragOver(e, row, index) {
        if (!draggingOption || draggingOption.rowId !== row.id) return;
        const pIndex = optionPlaceholderIndex(row.survey.options);
        if (pIndex !== -1 && index >= pIndex) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggingOption.index === index) return;
        const options = [...row.survey.options];
        const [item] = options.splice(draggingOption.index, 1);
        options.splice(index, 0, item);
        updateRow(row.id, { survey: { ...row.survey, options } });
        setDraggingOption({ rowId: row.id, index });
    }

    function endOptionDrag() {
        setDraggingOption(null);
    }

    /** Girildiği anda doğrulama — bkz. agent_flow.md "URL doğrulaması
     *  editörde, girildiği anda yapılır". Ürün henüz hiç site/allowlist
     *  tanımlamadıysa (yeni ürün) uyarı bastırılır; sunucu kaydederken zaten
     *  otoriter kontrolü tekrar yapıyor. */
    function urlWarning(row) {
        const url = row.url?.trim();
        if (!url) return '';
        if (!product.websiteUrl && !product.tourAllowedDomains?.length) return '';
        if (!isTourNavigableUrl(url, product)) {
            return "Bu adres ürünün izinli alan adları dışında — kaydederken reddedilebilir.";
        }
        return '';
    }

    const filledRows = useMemo(() => rows.filter((r) => rowText(r).trim()), [rows]);

    async function onGenerate() {
        setError('');
        setGenerating(true);
        setGeneratedDraft(null);
        try {
            const draft = await agentsApi.generatePlaybook(id, {
                source: creationMode === 'preset' ? 'preset' : 'ai',
                brief: generationBrief.trim(),
                strategy: generationStrategy,
                preset: creationMode === 'preset' ? generationPreset : null,
                includeSurvey: includeSurvey && (Number(data?.maxParticipants) || 1) <= 1,
                maxNodes: 6
            });
            setGeneratedDraft(draft);
        } catch (err) {
            setError(err.message);
        } finally {
            setGenerating(false);
        }
    }

    function applyGeneratedDraft() {
        if (!generatedDraft?.nodes?.length) return;
        setRows(rowsFromServer(generatedDraft.nodes));
        setGeneratedDraft(null);
        setSaved(false);
        setCreationMode('custom');
    }

    async function onSave() {
        setError('');
        setSaving(true);
        try {
            const nodes = filledRows.map((r, i) => {
                const question = r.survey?.question?.trim() || '';
                return {
                    id: r.id,
                    order: i + 1,
                    type: r.type || 'narrative',
                    directive: r.type === 'survey' ? question : r.directive.trim(),
                    url: r.url?.trim() || null,
                    actions: (r.actions || []).map((a) => a.trim()).filter(Boolean),
                    mode: r.mode,
                    survey: r.type === 'survey'
                        ? {
                              ...r.survey,
                              question,
                              options: r.survey.answerType === 'single-choice'
                                  ? r.survey.options
                                      .map((option) => ({ ...option, label: option.label.trim() }))
                                      .filter((option) => option.label)
                                  : []
                          }
                        : null
                };
            });
            const result = await agentsApi.savePlaybook(id, { nodes, enabled: true });
            setRows(rowsFromServer(result.nodes));
            queryClient.invalidateQueries({ queryKey: ['agent-playbook', id] });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (isLoading) return <p className="text-sm text-text-muted">Yükleniyor…</p>;

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
                <h1 className="text-xl font-semibold text-text">Hedefler</h1>
                <p className="mt-1 text-sm text-text-muted">
                    Agent'ın her ziyaretçide izleyeceği genel güzergah. Sırayla ilerler, ziyaretçinin
                    sorularına göre esner.
                </p>
            </div>

            <section className="mb-5 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-text">Akış oluşturma</h2>
                        <p className="mt-0.5 text-xs text-text-muted">
                            Manuel düzenle, şirket bilgisiyle AI taslağı üret veya hazır bir başlangıç akışı seç.
                        </p>
                    </div>
                    <div className="flex rounded-[var(--radius-input)] border border-border bg-bg p-1">
                        {[
                            ['custom', 'Özel'],
                            ['ai', 'AI generated'],
                            ['preset', 'Hazır preset']
                        ].map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => { setCreationMode(value); setGeneratedDraft(null); }}
                                className={`rounded-[calc(var(--radius-input)-3px)] px-3 py-1.5 text-xs transition-colors ${creationMode === value
                                    ? 'bg-brand/15 text-brand-light'
                                    : 'text-text-muted hover:text-text'
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {creationMode !== 'custom' && (
                    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_13rem]">
                        <div>
                            {creationMode === 'ai' ? (
                                <textarea
                                    value={generationBrief}
                                    onChange={(event) => setGenerationBrief(event.target.value)}
                                    maxLength={1500}
                                    rows={3}
                                    placeholder="Örn. Midas kullanıcılarına odaklan; önce ihtiyaçlarını sor, sonra ekstre yükleme ve sonuç ekranını göster."
                                    className="w-full resize-y rounded-[var(--radius-input)] border border-border bg-bg px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-muted/60 focus:border-brand"
                                />
                            ) : (
                                <select
                                    value={generationPreset}
                                    onChange={(event) => setGenerationPreset(event.target.value)}
                                    className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-bg px-3 text-sm text-text outline-none focus:border-brand"
                                >
                                    <option value="guided-demo">Rehberli ürün demosu</option>
                                    <option value="discovery">Danışmanlık odaklı keşif</option>
                                    <option value="qualification">Hızlı ön görüşme</option>
                                </select>
                            )}
                            <p className="mt-1.5 text-[11px] text-text-muted">
                                Taslak önce burada önizlenir; siz uygulayıp Kaydet'e basmadan canlı akış değişmez.
                            </p>
                        </div>

                        <div className="flex flex-col gap-2">
                            {creationMode === 'ai' && (
                                <select
                                    value={generationStrategy}
                                    onChange={(event) => setGenerationStrategy(event.target.value)}
                                    className="h-10 rounded-[var(--radius-input)] border border-border bg-bg px-2 text-xs text-text outline-none focus:border-brand"
                                >
                                    <option value="consultative">Danışmanlık odaklı</option>
                                    <option value="storytelling">Hikâye anlatımı</option>
                                    <option value="sector-aware">Sektör dinamikleri</option>
                                </select>
                            )}
                            <label className="flex items-center gap-2 text-xs text-text-muted">
                                <input
                                    type="checkbox"
                                    checked={includeSurvey}
                                    disabled={Number(data?.maxParticipants) > 1}
                                    onChange={(event) => setIncludeSurvey(event.target.checked)}
                                />
                                Görüşme içi kısa anket ekle
                            </label>
                            <button
                                type="button"
                                onClick={onGenerate}
                                disabled={generating}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-input)] bg-brand px-3 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                            >
                                <Sparkles size={15} />
                                {generating ? 'Taslak hazırlanıyor…' : 'Taslak oluştur'}
                            </button>
                        </div>
                    </div>
                )}

                {generatedDraft?.nodes?.length > 0 && (
                    <div className="mt-4 rounded-[var(--radius-input)] border border-brand/30 bg-brand/5 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <p className="text-sm font-medium text-text">{generatedDraft.nodes.length} adımlık taslak hazır</p>
                                <p className="text-[11px] text-text-muted">
                                    {generatedDraft.context?.topicCount || 0} bilgi başlığı ve {generatedDraft.context?.pageCount || 0} doğrulanmış sayfa kullanıldı.
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setGeneratedDraft(null)}
                                    className="rounded-[var(--radius-input)] border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text"
                                >
                                    Vazgeç
                                </button>
                                <button
                                    type="button"
                                    onClick={applyGeneratedDraft}
                                    className="rounded-[var(--radius-input)] bg-brand px-3 py-1.5 text-xs font-medium text-white"
                                >
                                    Editöre uygula
                                </button>
                            </div>
                        </div>
                        <ol className="mt-3 grid gap-1.5">
                            {generatedDraft.nodes.map((node, index) => (
                                <li key={node.id || index} className="flex gap-2 text-xs text-text-muted">
                                    <span className="text-brand-light">{index + 1}.</span>
                                    <span>{node.type === 'survey' ? `Soru: ${node.survey?.question}` : node.directive}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}
            </section>

            <div className="mb-5 flex items-start gap-2.5 rounded-[var(--radius-input)] border border-brand/30 bg-brand/5 px-3.5 py-3">
                <Info size={15} className="mt-0.5 shrink-0 text-brand-light" />
                <p className="text-[13px] leading-relaxed text-text-muted">
                    Ne anlatılacağını maddele — agent hepsini kapsayana kadar sonraki adıma geçmez.
                    Bir adımda ekran gösterilecekse <Globe size={12} className="inline align-[-1px]" />{' '}
                    ikonuna, ekranda bir şey yapılacaksa (tıklama, seçim, yazma — birden fazla adım
                    sırayla eklenebilir){' '}
                    <Paperclip size={12} className="inline align-[-1px]" /> ikonuna bas.
                </p>
            </div>

            <div className="flex flex-col gap-2.5">
                {rows.map((row, index) => {
                    const warning = urlWarning(row);
                    const isPlaceholder = index === placeholderIndex(rows);
                    const isDragging = row.id === draggingId;
                    return (
                        <div
                            key={row.id}
                            ref={(el) => {
                                rowRefs.current.set(row.id, el);
                                return () => rowRefs.current.delete(row.id);
                            }}
                            onDragOver={(e) => handleRowDragOver(e, index)}
                            onDrop={(e) => { e.preventDefault(); endDrag(); }}
                            className={`group rounded-[var(--radius-card)] border border-border bg-surface p-3.5 transition-[opacity,colors] focus-within:border-brand/50 ${isDragging ? 'opacity-40' : 'opacity-100'
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                {isPlaceholder ? (
                                    <span className="h-8 w-4 shrink-0" aria-hidden="true" />
                                ) : (
                                    <button
                                        type="button"
                                        draggable
                                        onDragStart={(e) => handleGripDragStart(e, row)}
                                        onDragEnd={endDrag}
                                        onKeyDown={(e) => handleGripKeyDown(e, row, index)}
                                        title="Sürükleyerek sırala"
                                        aria-label={`${index + 1}. adımı sürükleyerek yeniden sırala`}
                                        className="flex h-8 w-4 shrink-0 cursor-grab items-center justify-center text-text-muted/40 opacity-0 transition-opacity hover:text-text-muted focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100 active:cursor-grabbing"
                                    >
                                        <GripVertical size={14} />
                                    </button>
                                )}

                                <span
                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${rowText(row).trim()
                                            ? 'bg-brand/15 text-brand-light'
                                            : 'bg-surface-raised text-text-muted'
                                        }`}
                                >
                                    {index + 1}
                                </span>

                                <select
                                    value={row.type}
                                    onChange={(e) => changeNodeType(row, e.target.value)}
                                    title="Adım türü"
                                    className="h-10 w-[6.5rem] shrink-0 rounded-[var(--radius-input)] border border-border bg-bg px-2 text-xs text-text outline-none focus:border-brand"
                                >
                                    {NODE_TYPE_OPTIONS.map((opt) => (
                                        <option
                                            key={opt.value}
                                            value={opt.value}
                                            disabled={opt.value === 'survey' && Number(data?.maxParticipants) > 1}
                                        >
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>

                                <input
                                    value={rowText(row)}
                                    onChange={(e) => row.type === 'survey'
                                        ? updateRow(row.id, { survey: { ...row.survey, question: e.target.value } })
                                        : updateRow(row.id, { directive: e.target.value })}
                                    placeholder={row.type === 'survey'
                                        ? 'Örn. Hangi aracı kurumu kullanıyorsunuz?'
                                        : 'Örn. Şirketi tanıt: kuruluş yılı, kaç ülkede faaliyet, müşteri sayısı'}
                                    className="h-10 min-w-0 flex-1 rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none placeholder:text-text-muted/60 focus:border-brand"
                                />

                                <select
                                    value={row.mode}
                                    onChange={(e) => updateRow(row.id, { mode: e.target.value })}
                                    title="Bu adımın kesintiye toleransı"
                                    className="h-10 w-[9.5rem] shrink-0 rounded-[var(--radius-input)] border border-border bg-bg px-2 text-xs text-text outline-none focus:border-brand"
                                >
                                    {MODE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>

                                <button
                                    type="button"
                                    onClick={() => toggleUrl(row)}
                                    title={row.url === null ? 'Sayfa adresi ekle' : 'Sayfa adresini kaldır'}
                                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] border transition-colors ${row.url !== null
                                            ? 'border-brand/50 bg-brand/10 text-brand-light'
                                            : 'border-border bg-surface-raised text-text-muted hover:border-brand/50 hover:text-text'
                                        }`}
                                >
                                    <Globe size={15} />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => toggleActions(row)}
                                    title={row.actions === null ? 'Ekran aksiyonu ekle' : 'Aksiyonları kaldır'}
                                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] border transition-colors ${row.actions !== null
                                            ? 'border-brand/50 bg-brand/10 text-brand-light'
                                            : 'border-border bg-surface-raised text-text-muted hover:border-brand/50 hover:text-text'
                                        }`}
                                >
                                    <Paperclip size={15} />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => removeRow(row.id)}
                                    disabled={rows.length === 1}
                                    title="Adımı sil"
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>

                            {row.url !== null && (
                                <div className="mt-2.5 flex items-center gap-2">
                                    <span className="h-8 w-4 shrink-0" aria-hidden="true" />
                                    <span className="h-7 w-7 shrink-0" aria-hidden="true" />
                                    <input
                                        value={row.url}
                                        onChange={(e) => updateRow(row.id, { url: e.target.value })}
                                        placeholder="https://www.cyberverse.com.tr/kvkk"
                                        className="h-9 min-w-0 flex-1 rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13px] text-brand-light outline-none placeholder:text-text-muted/60 focus:border-brand"
                                    />
                                    <span className="h-9 w-[9.5rem] shrink-0" aria-hidden="true" />
                                    <span className="h-9 w-10 shrink-0" aria-hidden="true" />
                                    <span className="h-9 w-10 shrink-0" aria-hidden="true" />
                                    <span className="h-9 w-10 shrink-0" aria-hidden="true" />
                                </div>
                            )}
                            {warning && (
                                <p className="ml-[3.75rem] mt-1.5 text-xs text-amber-400">{warning}</p>
                            )}

                            {row.type === 'survey' && row.survey && (
                                <div className="ml-[3.75rem] mt-3 rounded-[var(--radius-input)] border border-brand/20 bg-brand/5 p-3">
                                    <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
                                        <label className="text-xs text-text-muted">
                                            Cevap türü
                                            <select
                                                value={row.survey.answerType}
                                                onChange={(e) => updateRow(row.id, {
                                                    survey: {
                                                        ...row.survey,
                                                        answerType: e.target.value,
                                                        options: e.target.value === 'text' ? [] : withTrailingEmptyOption(row.survey.options),
                                                        allowFreeText: e.target.value === 'text' ? true : row.survey.allowFreeText
                                                    }
                                                })}
                                                className="mt-1 h-9 w-full rounded-[var(--radius-input)] border border-border bg-bg px-2 text-xs text-text outline-none focus:border-brand"
                                            >
                                                <option value="single-choice">Tek seçim</option>
                                                <option value="text">Serbest metin</option>
                                            </select>
                                        </label>

                                        {row.survey.answerType === 'single-choice' && (
                                            <div className="text-xs text-text-muted">
                                                Seçenekler
                                                <div className="mt-1 flex flex-col gap-1.5">
                                                    {row.survey.options.map((option, optionIndex) => {
                                                        const isOptionPlaceholder = optionIndex === optionPlaceholderIndex(row.survey.options);
                                                        const isDraggingOption = draggingOption?.rowId === row.id && draggingOption.index === optionIndex;
                                                        return (
                                                            <div
                                                                key={option.value}
                                                                onDragOver={(e) => handleOptionDragOver(e, row, optionIndex)}
                                                                onDrop={(e) => { e.preventDefault(); endOptionDrag(); }}
                                                                className={`flex items-center gap-1.5 transition-opacity ${isDraggingOption ? 'opacity-40' : 'opacity-100'}`}
                                                            >
                                                                {isOptionPlaceholder ? (
                                                                    <span className="h-9 w-5 shrink-0" aria-hidden="true" />
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        draggable
                                                                        onDragStart={(e) => handleOptionDragStart(e, row, optionIndex)}
                                                                        onDragEnd={endOptionDrag}
                                                                        title="Sürükleyerek sırala"
                                                                        aria-label={`${optionIndex + 1}. seçeneği yeniden sırala`}
                                                                        className="flex h-9 w-5 shrink-0 cursor-grab items-center justify-center text-text-muted/40 hover:text-text-muted active:cursor-grabbing"
                                                                    >
                                                                        <GripVertical size={13} />
                                                                    </button>
                                                                )}
                                                                <input
                                                                    value={option.label}
                                                                    onChange={(e) => updateOptionLabel(row, optionIndex, e.target.value)}
                                                                    placeholder={`Seçenek ${optionIndex + 1}`}
                                                                    className="h-9 min-w-0 flex-1 rounded-[var(--radius-input)] border border-border bg-bg px-2.5 text-xs text-text outline-none focus:border-brand"
                                                                />
                                                                {!isOptionPlaceholder && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeOption(row, optionIndex)}
                                                                        title="Seçeneği sil"
                                                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-text-muted/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
                                                                    >
                                                                        <Trash2 size={13} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-5 text-xs text-text-muted">
                                        {row.survey.answerType === 'single-choice' && (
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={row.survey.allowFreeText}
                                                    onChange={(e) => updateRow(row.id, {
                                                        survey: { ...row.survey, allowFreeText: e.target.checked }
                                                    })}
                                                />
                                                Diğer cevaba izin ver
                                            </label>
                                        )}
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={row.survey.required}
                                                onChange={(e) => updateRow(row.id, {
                                                    survey: { ...row.survey, required: e.target.checked }
                                                })}
                                            />
                                            Cevap zorunlu
                                        </label>
                                    </div>
                                </div>
                            )}

                            {row.actions !== null && (
                                <div className="mt-2.5 flex flex-col gap-1.5">
                                    {row.actions.map((action, actionIndex) => {
                                        const isActionPlaceholder = actionIndex === actionPlaceholderIndex(row.actions);
                                        return (
                                            <div key={actionIndex} className="flex items-center gap-2">
                                                <span className="h-8 w-4 shrink-0" aria-hidden="true" />
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[11px] text-text-muted/60">
                                                    {actionIndex + 1}
                                                </span>
                                                <input
                                                    value={action}
                                                    onChange={(e) => updateActionText(row, actionIndex, e.target.value)}
                                                    placeholder={actionIndex === 0
                                                        ? 'Örn. "Category" alanına tıkla'
                                                        : 'Sıradaki adım, örn. "Staff" yaz'}
                                                    className="h-9 min-w-0 flex-1 rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13px] text-text outline-none placeholder:text-text-muted/60 focus:border-brand"
                                                />
                                                <span className="h-9 w-[9.5rem] shrink-0" aria-hidden="true" />
                                                <span className="h-9 w-10 shrink-0" aria-hidden="true" />
                                                <span className="h-9 w-10 shrink-0" aria-hidden="true" />
                                                {isActionPlaceholder ? (
                                                    <span className="h-9 w-10 shrink-0" aria-hidden="true" />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeAction(row, actionIndex)}
                                                        title="Adımı sil"
                                                        className="flex h-9 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-text-muted/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {error && (
                <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                    <AlertCircle size={16} className="shrink-0" />
                    {error}
                </div>
            )}

            <div className="mt-6 flex items-center gap-3">
                <Button onClick={onSave} disabled={saving}>
                    {saved ? <Check size={16} /> : <Target size={16} />}
                    {saving ? 'Kaydediliyor…' : saved ? 'Kaydedildi' : 'Kaydet'}
                </Button>
                <p className="text-xs text-text-muted">{filledRows.length} adım</p>
            </div>
        </div>
    );
}
