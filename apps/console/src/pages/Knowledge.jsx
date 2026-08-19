import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KnowledgeSourceInput } from '@repo/contracts';
import { Button, Input } from '@repo/ui';
import {
    Plus,
    FileText,
    Link as LinkIcon,
    Image as ImageIcon,
    Video,
    Code,
    File,
    Trash2,
    X,
    AlertCircle,
    Loader2,
    CheckCircle2,
    XCircle,
    Clock,
    UploadCloud,
    Search,
    ChevronDown,
    ChevronRight,
    FolderArchive,
    ShieldCheck
} from 'lucide-react';
import { productsApi, knowledgeApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { getSocket } from '../lib/socket.js';

const TYPES = [
    { value: 'text', label: 'Metin', icon: FileText },
    { value: 'url', label: 'URL / Web sitesi', icon: LinkIcon },
    { value: 'document', label: 'Doküman', icon: File },
    { value: 'image', label: 'Görsel', icon: ImageIcon },
    { value: 'video', label: 'Video', icon: Video },
    { value: 'api', label: 'API / OpenAPI', icon: Code }
];

const STATUS = {
    pending: { label: 'Bekliyor', icon: Clock, className: 'text-text-muted bg-surface-raised' },
    processing: { label: 'İşleniyor', icon: Loader2, className: 'text-brand-light bg-brand/15', spin: true },
    ready: { label: 'Hazır', icon: CheckCircle2, className: 'text-emerald-400 bg-emerald-500/10' },
    failed: { label: 'Başarısız', icon: XCircle, className: 'text-red-400 bg-red-500/10' }
};

function Dropzone({ file, accept, onFile }) {
    const [dragging, setDragging] = useState(false);

    function handleDrop(e) {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
    }

    return (
        <label
            onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-input)] border-2 border-dashed px-3 py-8 text-center transition-colors ${
                dragging ? 'border-brand bg-brand/10' : 'border-border hover:border-brand/50'
            }`}
        >
            <UploadCloud size={22} className={dragging ? 'text-brand-light' : 'text-text-muted'} />
            <p className="text-sm text-text">
                {file ? file.name : 'Dosyayı sürükle bırak ya da seçmek için tıkla'}
            </p>
            <input
                type="file"
                required={!file}
                accept={accept}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                className="hidden"
            />
        </label>
    );
}

/** A single knowledge source row; renders as a collapsible group header when `isGroup` is set (zip uploads). */
function SourceRow({ source: s, icon, isGroup, expanded, onToggle, childCount, onDelete }) {
    const typeInfo = TYPES.find((t) => t.value === s.type) ?? TYPES[0];
    const statusInfo = STATUS[s.status] ?? STATUS.pending;
    const TypeIcon = icon || typeInfo.icon;
    const StatusIcon = statusInfo.icon;

    return (
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
            {isGroup && (
                <button
                    onClick={onToggle}
                    aria-label={expanded ? 'Daralt' : 'Genişlet'}
                    className="shrink-0 text-text-muted transition-colors hover:text-text"
                >
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
            )}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-text-muted">
                <TypeIcon size={15} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">
                    {s.title || s.url || typeInfo.label}
                </p>
                <p className="text-xs text-text-muted">
                    {isGroup ? `Zip · ${childCount} dosya` : typeInfo.label}
                </p>
            </div>
            <span
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusInfo.className}`}
            >
                <StatusIcon size={12} className={statusInfo.spin ? 'animate-spin' : ''} />
                {statusInfo.label}
            </span>
            <button
                onClick={() => onDelete(s._id)}
                className="text-text-muted transition-colors hover:text-red-400"
                title="Sil"
            >
                <Trash2 size={16} />
            </button>
        </div>
    );
}

/** title/content/url are validated with the real API contract; conditional per-type requiredness added via superRefine. */
function buildSourceSchema(type, productId) {
    return z.preprocess(
        (data) => ({
            productId,
            type,
            title: data?.title || undefined,
            content: data?.content || undefined,
            url: data?.url || undefined
        }),
        KnowledgeSourceInput.superRefine((val, ctx) => {
            if (val.type === 'text' && !val.content) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'İçerik gerekli' });
            }
            if ((val.type === 'url' || val.type === 'api') && !val.url) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'Geçerli bir URL gir' });
            }
        })
    );
}

function AddSourceModal({ productId, onClose, onCreated }) {
    const [type, setType] = useState('text');
    const [file, setFile] = useState(null);
    const [error, setError] = useState('');
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting }
    } = useForm({
        resolver: zodResolver(buildSourceSchema(type, productId)),
        defaultValues: { title: '', content: '', url: '' }
    });

    async function onSubmit(values) {
        setError('');
        try {
            const payload = { ...values };
            if (type === 'document' || type === 'image' || type === 'video') {
                if (!file) throw new Error('Bir dosya seç');
                const { fileKey, mimeType } = await knowledgeApi.uploadFile(file);
                payload.fileKey = fileKey;
                payload.mimeType = mimeType;
            }
            await knowledgeApi.create(payload);
            onCreated();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-6">
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-text">Knowledge ekle</h2>
                    <button onClick={onClose} aria-label="Kapat" className="text-text-muted hover:text-text">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)}>
                    <div className="mb-4 grid grid-cols-3 gap-2">
                        {TYPES.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setType(value)}
                                className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-input)] border px-2 py-3 text-xs transition-colors ${
                                    type === value
                                        ? 'border-brand bg-brand/10 text-brand-light'
                                        : 'border-border text-text-muted hover:border-brand/40 hover:text-text'
                                }`}
                            >
                                <Icon size={16} />
                                {label}
                            </button>
                        ))}
                    </div>

                    <Input
                        id="source-title"
                        label="Başlık (opsiyonel)"
                        placeholder="Örn. Fiyatlandırma sayfası"
                        error={errors.title?.message}
                        {...register('title')}
                    />

                    {type === 'text' && (
                        <label className="mb-4 block text-sm">
                            <span className="mb-1.5 block font-medium text-text-muted">İçerik</span>
                            <textarea
                                rows={5}
                                placeholder="Ürününüz hakkında metin, SSS, satış argümanları…"
                                className="w-full resize-none rounded-[var(--radius-input)] border border-border bg-bg px-3 py-2 text-[13.5px] text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                                {...register('content')}
                            />
                            {errors.content && <p className="mt-1.5 text-xs text-red-400">{errors.content.message}</p>}
                        </label>
                    )}

                    {(type === 'url' || type === 'api') && (
                        <Input
                            id="source-url"
                            label={type === 'api' ? 'OpenAPI / API URL' : 'Web sitesi URL'}
                            type="url"
                            placeholder="https://..."
                            error={errors.url?.message}
                            {...register('url')}
                        />
                    )}

                    {(type === 'document' || type === 'image' || type === 'video') && (
                        <div className="mb-4">
                            <span className="mb-1.5 block text-sm font-medium text-text-muted">Dosya</span>
                            <Dropzone
                                file={file}
                                accept={type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : undefined}
                                onFile={setFile}
                            />
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                            <AlertCircle size={16} className="shrink-0" />
                            {error}
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={onClose}>
                            Vazgeç
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Ekleniyor…' : 'Ekle'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export function Knowledge() {
    const workspace = useAuthStore((s) => s.workspace);
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [showModal, setShowModal] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState(() => new Set());
    const productId = searchParams.get('product');

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

    const { data: sources } = useQuery({
        queryKey: ['knowledge', productId],
        queryFn: () => knowledgeApi.list(productId),
        enabled: !!productId
    });

    useEffect(() => {
        if (!productId) return;
        const socket = getSocket();
        const onUpdate = (payload) => {
            if (payload.productId && payload.productId !== productId) return;
            queryClient.invalidateQueries({ queryKey: ['knowledge', productId] });
        };
        socket.on('ingestion:progress', onUpdate);
        socket.on('ingestion:ready', onUpdate);
        return () => {
            socket.off('ingestion:progress', onUpdate);
            socket.off('ingestion:ready', onUpdate);
        };
    }, [productId, queryClient]);

    // Zip uploads create one child KnowledgeSource per file (parentSourceId set);
    // group those under their parent instead of showing them as a flat pile.
    const { topLevelSources, childrenByParent } = useMemo(() => {
        const childrenByParent = new Map();
        const topLevelSources = [];
        for (const s of sources || []) {
            if (s.parentSourceId) {
                const list = childrenByParent.get(s.parentSourceId) || [];
                list.push(s);
                childrenByParent.set(s.parentSourceId, list);
            } else {
                topLevelSources.push(s);
            }
        }
        return { topLevelSources, childrenByParent };
    }, [sources]);

    function toggleGroup(id) {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function onDelete(id) {
        await knowledgeApi.remove(id);
        queryClient.invalidateQueries({ queryKey: ['knowledge', productId] });
    }

    function onCreated() {
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: ['knowledge', productId] });
    }

    if (products && products.length === 0) {
        return (
            <div>
                <h1 className="text-xl font-semibold text-text">Knowledge</h1>
                <p className="mt-4 text-sm text-text-muted">
                    Önce bir ürün oluşturmalısın. Overview sayfasından "Yeni ürün" ile başla.
                </p>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-text">Knowledge</h1>
                    <p className="mt-1 text-sm text-text-muted">
                        Ürününüz hakkında bilgi ekleyin — agent bunları kullanarak cevap verir.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {products && products.length > 1 && (
                        <select
                            value={productId ?? ''}
                            onChange={(e) => setSearchParams({ product: e.target.value })}
                            className="h-10 rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"
                        >
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    )}
                    {productId && (
                        <Link
                            to={`/knowledge/gaps?product=${productId}`}
                            className="flex h-10 items-center gap-1.5 rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm font-medium text-text-muted transition-colors hover:border-brand/50 hover:text-text"
                        >
                            <Search size={15} />
                            Bilgi boşlukları
                        </Link>
                    )}
                    {productId && (
                        <Link
                            to={`/knowledge/audit?product=${productId}`}
                            className="flex h-10 items-center gap-1.5 rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm font-medium text-text-muted transition-colors hover:border-brand/50 hover:text-text"
                        >
                            <ShieldCheck size={15} />
                            Bilgi denetimi
                        </Link>
                    )}
                    <Button onClick={() => setShowModal(true)} disabled={!productId}>
                        <Plus size={16} />
                        Kaynak ekle
                    </Button>
                </div>
            </div>

            {topLevelSources.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <FileText size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Henüz knowledge kaynağı yok.</p>
                    <Button size="sm" variant="secondary" className="mt-4" onClick={() => setShowModal(true)}>
                        İlk kaynağı ekle
                    </Button>
                </div>
            )}

            {topLevelSources.length > 0 && (
                <div className="flex flex-col gap-2">
                    {topLevelSources.map((s) => {
                        const children = childrenByParent.get(s._id) || [];
                        const isGroup = children.length > 0;
                        const expanded = expandedGroups.has(s._id);
                        return (
                            <div key={s._id}>
                                <SourceRow
                                    source={s}
                                    icon={isGroup ? FolderArchive : undefined}
                                    isGroup={isGroup}
                                    expanded={expanded}
                                    onToggle={isGroup ? () => toggleGroup(s._id) : undefined}
                                    childCount={children.length}
                                    onDelete={onDelete}
                                />
                                {isGroup && expanded && (
                                    <div className="ml-6 mt-2 flex flex-col gap-2 border-l border-border pl-4">
                                        {children.map((c) => (
                                            <SourceRow key={c._id} source={c} onDelete={onDelete} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {showModal && productId && (
                <AddSourceModal productId={productId} onClose={() => setShowModal(false)} onCreated={onCreated} />
            )}
        </div>
    );
}
