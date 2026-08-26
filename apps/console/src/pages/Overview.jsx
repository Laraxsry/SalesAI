import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ProductInput } from '@repo/contracts';
import { Button, Input } from '@repo/ui';
import { Plus, Package, ExternalLink, X, AlertCircle, ArrowUpRight, Activity, Layers3, ShieldCheck } from 'lucide-react';
import { productsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

function NewProductModal({ onClose, onCreated }) {
    const [error, setError] = useState('');
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting }
    } = useForm({ resolver: zodResolver(ProductInput), defaultValues: { name: '', description: '', websiteUrl: '' } });

    async function onSubmit(values) {
        setError('');
        try {
            const product = await productsApi.create({
                name: values.name,
                description: values.description || undefined,
                websiteUrl: values.websiteUrl || undefined
            });
            onCreated(product);
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071713]/65 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-[24px] border border-border bg-surface p-7 shadow-[0_32px_100px_-35px_rgba(7,23,19,0.6)]">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand">Yeni çalışma alanı</p>
                        <h2 className="text-xl font-semibold text-text">Ürününü SalesAI'a tanıt</h2>
                    </div>
                    <button onClick={onClose} aria-label="Kapat" className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-raised text-text-muted hover:text-text">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)}>
                    <Input
                        id="product-name"
                        label="Ürün adı"
                        placeholder="CRM Yazılımım"
                        error={errors.name?.message}
                        {...register('name')}
                    />
                    <Input
                        id="product-description"
                        label="Açıklama (opsiyonel)"
                        placeholder="Kısa bir açıklama"
                        error={errors.description?.message}
                        {...register('description')}
                    />
                    <Input
                        id="product-url"
                        label="Website URL (opsiyonel)"
                        type="url"
                        placeholder="https://urunum.com"
                        error={errors.websiteUrl?.message}
                        {...register('websiteUrl')}
                    />

                    {error && (
                        <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                            <AlertCircle size={16} className="shrink-0" />
                            {error}
                        </div>
                    )}

                    <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
                        <Button type="button" variant="ghost" onClick={onClose}>
                            Vazgeç
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Oluşturuluyor…' : 'Oluştur'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export function Overview() {
    const workspace = useAuthStore((s) => s.workspace);
    const queryClient = useQueryClient();
    const [showModal, setShowModal] = useState(false);

    const { data: products, isLoading, error } = useQuery({
        queryKey: ['products', workspace?.id],
        queryFn: () => productsApi.list(workspace.id),
        enabled: !!workspace?.id
    });

    function onCreated() {
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: ['products', workspace?.id] });
    }

    return (
        <div>
            <section className="relative mb-7 overflow-hidden rounded-[28px] bg-[#0d2923] px-6 py-7 text-white shadow-[0_24px_70px_-42px_rgba(7,23,19,0.65)] sm:px-8 sm:py-9">
                <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[48px] border-[#d7f95b]/[0.07]" />
                <div className="pointer-events-none absolute bottom-0 right-24 h-28 w-44 bg-[radial-gradient(circle,#d7f95b_1.2px,transparent_1.2px)] bg-[size:13px_13px] opacity-15" />
                <div className="relative flex flex-col justify-between gap-7 md:flex-row md:items-end">
                    <div className="max-w-2xl">
                        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold text-[#d7f95b]">
                            <Activity size={13} /> Satış operasyon merkezi
                        </span>
                        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">Ürünlerinizi satışa hazırlayın.</h1>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-white/55">
                            Bilgi kaynaklarını, AI temsilcileri ve görüşme performansını her ürün için tek yerden yönetin.
                        </p>
                    </div>
                    <Button onClick={() => setShowModal(true)} className="shrink-0 !bg-[#d7f95b] !text-[#0b1f1b] !shadow-none hover:!bg-[#c8ed43]">
                        <Plus size={16} />
                        Yeni ürün
                    </Button>
                </div>
            </section>

            <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/80 bg-surface/75 p-4 shadow-sm backdrop-blur">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-muted">Toplam ürün</span>
                        <Layers3 size={16} className="text-brand" />
                    </div>
                    <p className="mt-3 text-2xl font-bold text-text">{products?.length ?? '—'}</p>
                </div>
                <div className="rounded-2xl border border-border/80 bg-surface/75 p-4 shadow-sm backdrop-blur">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-muted">Operasyon durumu</span>
                        <Activity size={16} className="text-emerald-600" />
                    </div>
                    <p className="mt-3 text-sm font-bold text-text">Yönetim merkezi hazır</p>
                </div>
                <div className="rounded-2xl border border-border/80 bg-surface/75 p-4 shadow-sm backdrop-blur">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-muted">Veri güvenliği</span>
                        <ShieldCheck size={16} className="text-amber-600" />
                    </div>
                    <p className="mt-3 text-sm font-bold text-text">Çalışma alanına özel</p>
                </div>
            </div>

            <div className="mb-4 flex items-end justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-text">Ürün portföyü</h2>
                    <p className="mt-1 text-xs text-text-muted">Yönetmek istediğiniz ürünü seçin.</p>
                </div>
            </div>

            {isLoading && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2].map((item) => <div key={item} className="h-48 animate-pulse rounded-[22px] border border-border bg-surface/70" />)}
                </div>
            )}
            {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error.message}</div>}

            {products?.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-brand/30 bg-surface/60 px-6 py-16 text-center">
                    <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Package size={24} /></span>
                    <h3 className="text-lg font-semibold text-text">İlk ürününüzü ekleyin</h3>
                    <p className="mt-1 max-w-sm text-sm leading-6 text-text-muted">Bilgi kaynaklarını bağlamak ve AI temsilcinizi hazırlamak için bir ürün çalışma alanı oluşturun.</p>
                    <Button size="sm" variant="secondary" className="mt-4" onClick={() => setShowModal(true)}>
                        Ürün oluştur
                    </Button>
                </div>
            )}

            {products?.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {products.map((p, index) => (
                        <Link
                            key={p.id}
                            to={`/products/${p.id}`}
                            className="card-lift group relative overflow-hidden rounded-[22px] border border-border/90 bg-surface p-5 hover:border-brand/35"
                        >
                            <div className="absolute right-5 top-5 text-[11px] font-bold tracking-[0.16em] text-text-muted/45">{String(index + 1).padStart(2, '0')}</div>
                            <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0d2923] text-[#d7f95b] shadow-[0_10px_25px_-14px_rgba(13,41,35,0.7)]">
                                <Package size={18} />
                            </div>
                            <h3 className="text-lg font-semibold text-text transition-colors group-hover:text-brand">{p.name}</h3>
                            {p.description && (
                                <p className="mt-1.5 line-clamp-2 min-h-10 text-sm leading-5 text-text-muted">{p.description}</p>
                            )}
                            <div className="mt-5 flex items-center justify-between border-t border-border/70 pt-4">
                                <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold text-text-muted">
                                    <ExternalLink size={12} />
                                    {p.websiteUrl ? p.websiteUrl.replace(/^https?:\/\//, '') : 'Web sitesi eklenmedi'}
                                </p>
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-brand transition-transform group-hover:translate-x-0.5"><ArrowUpRight size={14} /></span>
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {showModal && <NewProductModal onClose={() => setShowModal(false)} onCreated={onCreated} />}
        </div>
    );
}
