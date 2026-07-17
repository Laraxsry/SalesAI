import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@repo/ui';
import { Plus, Package, ExternalLink, X, AlertCircle } from 'lucide-react';
import { productsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

function NewProductModal({ onClose, onCreated }) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const product = await productsApi.create({
                name,
                description: description || undefined,
                websiteUrl: websiteUrl || undefined
            });
            onCreated(product);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-6">
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-text">Yeni ürün</h2>
                    <button onClick={onClose} className="text-text-muted hover:text-text">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={onSubmit}>
                    <Input
                        id="product-name"
                        label="Ürün adı"
                        placeholder="CRM Yazılımım"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <Input
                        id="product-description"
                        label="Açıklama (opsiyonel)"
                        placeholder="Kısa bir açıklama"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                    <Input
                        id="product-url"
                        label="Website URL (opsiyonel)"
                        type="url"
                        placeholder="https://urunum.com"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                    />

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
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Oluşturuluyor…' : 'Oluştur'}
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
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-text">Ürünler</h1>
                    <p className="mt-1 text-sm text-text-muted">
                        Bir ürün seç ya da yeni bir tane oluştur — knowledge ve agent'lar buraya bağlanır.
                    </p>
                </div>
                <Button onClick={() => setShowModal(true)}>
                    <Plus size={16} />
                    Yeni ürün
                </Button>
            </div>

            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}
            {error && <p className="text-sm text-red-400">{error.message}</p>}

            {products?.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <Package size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Henüz ürün yok.</p>
                    <Button size="sm" variant="secondary" className="mt-4" onClick={() => setShowModal(true)}>
                        İlk ürününü oluştur
                    </Button>
                </div>
            )}

            {products?.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {products.map((p) => (
                        <Link
                            key={p.id}
                            to={`/products/${p.id}`}
                            className="group rounded-[var(--radius-card)] border border-border bg-surface p-5 transition-colors hover:border-brand/50"
                        >
                            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-brand-light">
                                <Package size={16} />
                            </div>
                            <h3 className="font-semibold text-text group-hover:text-brand-light">{p.name}</h3>
                            {p.description && (
                                <p className="mt-1 line-clamp-2 text-sm text-text-muted">{p.description}</p>
                            )}
                            {p.websiteUrl && (
                                <p className="mt-3 flex items-center gap-1 text-xs text-text-muted">
                                    <ExternalLink size={12} />
                                    {p.websiteUrl.replace(/^https?:\/\//, '')}
                                </p>
                            )}
                        </Link>
                    ))}
                </div>
            )}

            {showModal && <NewProductModal onClose={() => setShowModal(false)} onCreated={onCreated} />}
        </div>
    );
}
