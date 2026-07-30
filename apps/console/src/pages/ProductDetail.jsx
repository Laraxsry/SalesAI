import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, BookOpen, Bot, Key, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { productsApi } from '../lib/api.js';

function DemoSessionForm({ product }) {
    const queryClient = useQueryClient();
    const [jsonStr, setJsonStr] = useState(
        product.demoSession ? JSON.stringify(product.demoSession, null, 2) : ''
    );
    const [error, setError] = useState(null);

    const mutation = useMutation({
        mutationFn: (demoSession) => productsApi.update(product.id, { demoSession }),
        onSuccess: () => {
            queryClient.invalidateQueries(['product', product.id]);
            setError(null);
            alert('Demo oturumu başarıyla kaydedildi!');
        },
        onError: (err) => setError(err.message)
    });

    const handleSave = () => {
        if (!jsonStr.trim()) {
            mutation.mutate(null);
            return;
        }
        try {
            const parsed = JSON.parse(jsonStr);
            mutation.mutate(parsed);
        } catch (e) {
            setError('Geçersiz JSON formatı: ' + e.message);
        }
    };

    return (
        <div className="mt-8 rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <div className="flex items-center gap-2 mb-2">
                <Key size={18} className="text-brand-light" />
                <h2 className="text-lg font-medium text-text">Demo Oturumu (Guided Tour)</h2>
            </div>
            <p className="text-sm text-text-muted mb-4">
                AI temsilcinizin ürününüzü ziyaretçilere gösterirken (Ekran Paylaşımı Turu) sitenize hangi hesapla giriş yapacağını buradan ayarlayabilirsiniz.
            </p>
            
            <div className="mb-4 rounded bg-bg-muted p-3 text-xs text-text-muted border border-border/50">
                <p className="flex items-center gap-1.5 font-medium text-brand-light mb-1">
                    <AlertTriangle size={14} /> Güvenlik Uyarısı
                </p>
                <ul className="list-disc pl-4 space-y-1">
                    <li>Buraya eklediğiniz oturum bilgileri (cookie) veritabanımızda <strong>AES-256-GCM ile şifrelenerek</strong> saklanır.</li>
                    <li>Sadece <strong>"Read-Only" (Sadece Okunabilir)</strong> yetkilere sahip, gerçek müşteri verisi içermeyen bir demo hesabı kullanın.</li>
                    <li>Admin/Yönetici hesaplarının cookie'lerini buraya <strong>KESİNLİKLE</strong> girmeyin.</li>
                </ul>
            </div>

            <div className="mb-4">
                <label className="block text-xs font-medium text-text-muted mb-2">
                    Cookie / LocalStorage JSON
                </label>
                <textarea
                    className="w-full h-48 rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-sm text-text font-mono focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    placeholder='{"cookies": [{"name": "session", "value": "...", "domain": "example.com", "path": "/", "secure": true}]}'
                    value={jsonStr}
                    onChange={(e) => setJsonStr(e.target.value)}
                />
            </div>

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <div className="flex gap-3">
                <button
                    onClick={handleSave}
                    disabled={mutation.isPending}
                    className="rounded-[var(--radius-button)] bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                >
                    {mutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
                <a 
                    href="https://developer.chrome.com/docs/devtools/storage/cookies/" 
                    target="_blank" 
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-text-muted hover:text-text"
                >
                    <ExternalLink size={14} /> Nasıl kopyalarım?
                </a>
            </div>
        </div>
    );
}

export function ProductDetail() {
    const { id } = useParams();
    const { data: product, isLoading, error } = useQuery({
        queryKey: ['product', id],
        queryFn: () => productsApi.get(id)
    });

    if (isLoading) return <p className="text-sm text-text-muted">Yükleniyor…</p>;
    if (error) return <p className="text-sm text-red-400">{error.message}</p>;

    return (
        <div>
            <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text">
                <ArrowLeft size={14} />
                Ürünler
            </Link>

            <h1 className="text-2xl font-bold text-text">{product.name}</h1>
            {product.description && <p className="mt-2 text-sm text-text-muted">{product.description}</p>}
            {product.websiteUrl && (
                <a
                    href={product.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand-light hover:text-brand"
                >
                    <ExternalLink size={14} />
                    {product.websiteUrl}
                </a>
            )}

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Link
                    to={`/knowledge?product=${id}`}
                    className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-5 transition-colors hover:border-brand/50"
                >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-light">
                        <BookOpen size={18} />
                    </span>
                    <div>
                        <p className="font-medium text-text">Knowledge ekle</p>
                        <p className="text-xs text-text-muted">Metin, dosya, URL veya API bağla</p>
                    </div>
                </Link>

                <Link
                    to={`/agents?product=${id}`}
                    className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-5 transition-colors hover:border-brand/50"
                >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-light">
                        <Bot size={18} />
                    </span>
                    <div>
                        <p className="font-medium text-text">Agent oluştur</p>
                        <p className="text-xs text-text-muted">Bu ürün için AI temsilci kur</p>
                    </div>
                </Link>
            </div>

            <DemoSessionForm product={product} />
        </div>
    );
}
