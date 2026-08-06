import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { analyticsApi, productsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

export function KnowledgeGaps() {
    const workspace = useAuthStore((s) => s.workspace);
    const [searchParams, setSearchParams] = useSearchParams();
    const productId = searchParams.get('product') || '';

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

    const { data, isLoading } = useQuery({
        queryKey: ['knowledge-gaps', productId],
        queryFn: () => analyticsApi.knowledgeGaps(productId),
        enabled: !!productId
    });

    return (
        <div>
            <Link
                to={`/knowledge?product=${productId}`}
                className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
            >
                <ArrowLeft size={14} />
                Knowledge
            </Link>

            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold text-text">Bilgi boşlukları</h1>
                    <p className="mt-1 text-sm text-text-muted">
                        Agent'ın cevaplayamadığı sorular — buraya içerik ekleyerek boşluğu kapat.
                    </p>
                </div>

                {products?.length > 1 && (
                    <select
                        value={productId}
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
            </div>

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
        </div>
    );
}
