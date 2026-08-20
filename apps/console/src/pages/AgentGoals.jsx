import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui';
import { isTourNavigableUrl } from '@repo/contracts';
import { ArrowLeft, Globe, Paperclip, Trash2, Target, Info, AlertCircle, Check, GripVertical } from 'lucide-react';
import { agentsApi } from '../lib/api.js';

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

function makeRowId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `row-${Math.random().toString(36).slice(2)}`;
}

function emptyRow() {
    return { id: makeRowId(), directive: '', url: null, attach: null, mode: 'situational' };
}

/** Server nodes -> editor rows, with the first-step seed and a trailing
 *  empty row always guaranteed. */
function rowsFromServer(nodes) {
    const rows = (nodes || []).map((n) => ({
        id: n.id || makeRowId(),
        directive: n.directive || '',
        url: n.url ?? null,
        attach: n.attach ?? null,
        mode: n.mode || 'situational'
    }));

    if (rows.length === 0) {
        rows.push({ ...emptyRow(), directive: 'Kullanıcıya kısaca ürünü özetle' });
    }

    const last = rows[rows.length - 1];
    if (!last || last.directive.trim()) rows.push(emptyRow());
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
        return last && !last.directive.trim() ? list.length - 1 : -1;
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

    function withTrailingEmpty(next) {
        const last = next[next.length - 1];
        if (!last || last.directive.trim()) return [...next, emptyRow()];
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

    /** attach alanını aç/kapat, aynı kalıp. */
    function toggleAttach(row) {
        updateRow(row.id, { attach: row.attach === null ? '' : null });
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

    const filledRows = useMemo(() => rows.filter((r) => r.directive.trim()), [rows]);

    async function onSave() {
        setError('');
        setSaving(true);
        try {
            const nodes = filledRows.map((r, i) => ({
                id: r.id,
                order: i + 1,
                directive: r.directive.trim(),
                url: r.url?.trim() || null,
                attach: r.attach?.trim() || null,
                mode: r.mode
            }));
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

            <div className="mb-5 flex items-start gap-2.5 rounded-[var(--radius-input)] border border-brand/30 bg-brand/5 px-3.5 py-3">
                <Info size={15} className="mt-0.5 shrink-0 text-brand-light" />
                <p className="text-[13px] leading-relaxed text-text-muted">
                    Ne anlatılacağını maddele — agent hepsini kapsayana kadar sonraki adıma geçmez.
                    Bir adımda ekran gösterilecekse <Globe size={12} className="inline align-[-1px]" />{' '}
                    ikonuna, belirli bir öğeye tıklanacaksa{' '}
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
                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${row.directive.trim()
                                            ? 'bg-brand/15 text-brand-light'
                                            : 'bg-surface-raised text-text-muted'
                                        }`}
                                >
                                    {index + 1}
                                </span>

                                <input
                                    value={row.directive}
                                    onChange={(e) => updateRow(row.id, { directive: e.target.value })}
                                    placeholder="Örn. Şirketi tanıt: kuruluş yılı, kaç ülkede faaliyet, müşteri sayısı"
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
                                    onClick={() => toggleAttach(row)}
                                    title={row.attach === null ? 'Tıklanacak öğe ekle' : 'Öğeyi kaldır'}
                                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] border transition-colors ${row.attach !== null
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

                            {row.attach !== null && (
                                <div className="mt-2.5 flex items-center gap-2">
                                    <span className="h-8 w-4 shrink-0" aria-hidden="true" />
                                    <span className="h-7 w-7 shrink-0" aria-hidden="true" />
                                    <input
                                        value={row.attach}
                                        onChange={(e) => updateRow(row.id, { attach: e.target.value })}
                                        placeholder='Örn. "Rapor Ekle" butonu'
                                        className="h-9 min-w-0 flex-1 rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13px] text-text outline-none placeholder:text-text-muted/60 focus:border-brand"
                                    />
                                    <span className="h-9 w-[9.5rem] shrink-0" aria-hidden="true" />
                                    <span className="h-9 w-10 shrink-0" aria-hidden="true" />
                                    <span className="h-9 w-10 shrink-0" aria-hidden="true" />
                                    <span className="h-9 w-10 shrink-0" aria-hidden="true" />
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
