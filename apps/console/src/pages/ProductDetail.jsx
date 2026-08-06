import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, BookOpen, Bot, Key, AlertTriangle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { productsApi } from '../lib/api.js';

function DemoSessionForm({ product }) {
    const queryClient = useQueryClient();
    const existing = product.demoSession || {};
    const [loginUrl, setLoginUrl] = useState(existing.loginUrl || '');
    const [email, setEmail] = useState(existing.email || '');
    const [password, setPassword] = useState(existing.password || '');
    const [showAdvanced, setShowAdvanced] = useState(
        Boolean(existing.selectors?.email || existing.selectors?.password || existing.selectors?.submit)
    );
    const [emailSelector, setEmailSelector] = useState(existing.selectors?.email || '');
    const [passwordSelector, setPasswordSelector] = useState(existing.selectors?.password || '');
    const [submitSelector, setSubmitSelector] = useState(existing.selectors?.submit || '');
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
        if (!email.trim() || !password.trim()) {
            setError('Email ve şifre zorunludur.');
            return;
        }
        const selectors = {};
        if (emailSelector.trim()) selectors.email = emailSelector.trim();
        if (passwordSelector.trim()) selectors.password = passwordSelector.trim();
        if (submitSelector.trim()) selectors.submit = submitSelector.trim();

        setError(null);
        mutation.mutate({
            ...(loginUrl.trim() && { loginUrl: loginUrl.trim() }),
            email: email.trim(),
            password,
            ...(Object.keys(selectors).length > 0 && { selectors })
        });
    };

    const handleRemove = () => {
        if (!confirm('Demo oturumu bilgilerini kaldırmak istediğinize emin misiniz?')) return;
        mutation.mutate(null);
        setLoginUrl('');
        setEmail('');
        setPassword('');
        setEmailSelector('');
        setPasswordSelector('');
        setSubmitSelector('');
    };

    return (
        <div className="mt-8 rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <div className="flex items-center gap-2 mb-2">
                <Key size={18} className="text-brand-light" />
                <h2 className="text-lg font-medium text-text">Demo Oturumu (Guided Tour)</h2>
            </div>
            <p className="text-sm text-text-muted mb-4">
                AI temsilcinizin ürününüzü ziyaretçilere gösterirken (Ekran Paylaşımı Turu) sitenize hangi hesapla giriş
                yapacağını buradan ayarlayabilirsiniz. Tur her başladığında bu bilgilerle sitenizin gerçek giriş formu
                doldurulup giriş yapılır — süresi dolan bir oturum/token yapıştırmanız gerekmez.
            </p>

            <div className="mb-4 rounded bg-bg-muted p-3 text-xs text-text-muted border border-border/50">
                <p className="flex items-center gap-1.5 font-medium text-brand-light mb-1">
                    <AlertTriangle size={14} /> Güvenlik Uyarısı
                </p>
                <ul className="list-disc pl-4 space-y-1">
                    <li>Buraya girdiğiniz bilgiler (şifre dahil) veritabanımızda <strong>AES-256-GCM ile şifrelenerek</strong> saklanır.</li>
                    <li>Sadece <strong>"Read-Only" (Sadece Okunabilir)</strong> yetkilere sahip, gerçek müşteri verisi içermeyen bir demo hesabı kullanın.</li>
                    <li>Admin/Yönetici hesaplarının bilgilerini buraya <strong>KESİNLİKLE</strong> girmeyin.</li>
                </ul>
            </div>

            <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="block text-xs font-medium text-text-muted mb-2">Demo Hesap E-postası</label>
                    <input
                        type="email"
                        className="w-full rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-sm text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                        placeholder="demo@urun.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-text-muted mb-2">Demo Hesap Şifresi</label>
                    <input
                        type="password"
                        className="w-full rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-sm text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>
            </div>

            <div className="mb-4">
                <label className="block text-xs font-medium text-text-muted mb-2">
                    Giriş Sayfası URL'i <span className="text-text-muted/70">(opsiyonel — boş bırakılırsa ürün URL'i kullanılır)</span>
                </label>
                <input
                    type="text"
                    className="w-full rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-sm text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    placeholder="https://urun.com/login"
                    value={loginUrl}
                    onChange={(e) => setLoginUrl(e.target.value)}
                />
            </div>

            <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="mb-3 text-xs font-medium text-brand-light hover:underline"
            >
                {showAdvanced ? 'Gelişmiş ayarları gizle' : 'Gelişmiş ayarlar (form alanı bulunamazsa)'}
            </button>

            {showAdvanced && (
                <div className="mb-4 grid gap-4 rounded border border-border/50 bg-bg-muted p-3 sm:grid-cols-3">
                    <p className="sm:col-span-3 text-xs text-text-muted">
                        Giriş formu otomatik algılanır; algılama başarısız olursa DevTools'tan bulduğunuz CSS
                        selector'ları buraya girin.
                    </p>
                    <div>
                        <label className="block text-xs font-medium text-text-muted mb-2">Email input selector</label>
                        <input
                            type="text"
                            className="w-full rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-xs font-mono text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                            placeholder="otomatik algılanır"
                            value={emailSelector}
                            onChange={(e) => setEmailSelector(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-text-muted mb-2">Şifre input selector</label>
                        <input
                            type="text"
                            className="w-full rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-xs font-mono text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                            placeholder="otomatik algılanır"
                            value={passwordSelector}
                            onChange={(e) => setPasswordSelector(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-text-muted mb-2">Giriş butonu selector</label>
                        <input
                            type="text"
                            className="w-full rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-xs font-mono text-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                            placeholder="otomatik algılanır"
                            value={submitSelector}
                            onChange={(e) => setSubmitSelector(e.target.value)}
                        />
                    </div>
                </div>
            )}

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <div className="flex gap-3">
                <button
                    onClick={handleSave}
                    disabled={mutation.isPending}
                    className="rounded-[var(--radius-button)] bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                >
                    {mutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
                {product.demoSession && (
                    <button
                        onClick={handleRemove}
                        disabled={mutation.isPending}
                        className="rounded-[var(--radius-button)] px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                        Kaldır
                    </button>
                )}
            </div>
        </div>
    );
}

export function ProductDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [deleteError, setDeleteError] = useState(null);
    const { data: product, isLoading, error } = useQuery({
        queryKey: ['product', id],
        queryFn: () => productsApi.get(id)
    });

    const deleteMutation = useMutation({
        mutationFn: () => productsApi.remove(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            navigate('/');
        },
        onError: (err) => setDeleteError(err.message)
    });

    function handleDelete() {
        if (!confirm(`"${product.name}" ürününü ve ona bağlı tüm agent'ları silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) return;
        setDeleteError(null);
        deleteMutation.mutate();
    }

    if (isLoading) return <p className="text-sm text-text-muted">Yükleniyor…</p>;
    if (error) return <p className="text-sm text-red-400">{error.message}</p>;

    return (
        <div>
            <div className="mb-6 flex items-center justify-between">
                <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text">
                    <ArrowLeft size={14} />
                    Ürünler
                </Link>
                <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                    <Trash2 size={14} />
                    {deleteMutation.isPending ? 'Siliniyor…' : 'Ürünü sil'}
                </button>
            </div>
            {deleteError && <p className="mb-4 text-sm text-red-400">{deleteError}</p>}

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
