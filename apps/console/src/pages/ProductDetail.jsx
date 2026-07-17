import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, BookOpen, Bot } from 'lucide-react';
import { productsApi } from '../lib/api.js';

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
        </div>
    );
}
