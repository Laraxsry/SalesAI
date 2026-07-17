import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@repo/ui';
import { Plus, Bot, X, AlertCircle } from 'lucide-react';
import { productsApi, agentsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

const STATUS_STYLE = {
    draft: 'text-text-muted bg-surface-raised',
    active: 'text-emerald-400 bg-emerald-500/10',
    paused: 'text-amber-400 bg-amber-500/10',
    archived: 'text-text-muted bg-surface-raised'
};

const STATUS_LABEL = {
    draft: 'Taslak',
    active: 'Aktif',
    paused: 'Duraklatıldı',
    archived: 'Arşivlendi'
};

const AVATAR_PROVIDERS = [
    { value: 'voice-only', label: 'Sadece ses' },
    { value: 'tavus', label: 'Tavus' },
    { value: 'simli', label: 'Simli' },
    { value: 'heygen', label: 'HeyGen' },
    { value: 'did', label: 'D-ID' }
];

const SCREEN_MODES = [
    { value: 'guided-tour', label: 'Rehberli tur' },
    { value: 'customer-share', label: 'Müşteri ekran paylaşımı' }
];

const LANGUAGES = [
    { value: 'tr', label: 'Türkçe' },
    { value: 'en', label: 'English' }
];

function NewAgentModal({ productId, onClose, onCreated }) {
    const [name, setName] = useState('');
    const [tone, setTone] = useState('friendly, expert, concise');
    const [language, setLanguage] = useState('tr');
    const [goals, setGoals] = useState('');
    const [avatarProvider, setAvatarProvider] = useState('voice-only');
    const [screenModes, setScreenModes] = useState(['guided-tour', 'customer-share']);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    function toggleScreenMode(mode) {
        setScreenModes((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
    }

    async function onSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const agent = await agentsApi.create({
                productId,
                name,
                persona: {
                    tone,
                    language,
                    goals: goals
                        .split(',')
                        .map((g) => g.trim())
                        .filter(Boolean)
                },
                avatarProvider,
                screenModes
            });
            onCreated(agent);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-6">
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-text">Yeni agent</h2>
                    <button onClick={onClose} className="text-text-muted hover:text-text">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={onSubmit}>
                    <Input
                        id="agent-name"
                        label="Agent adı"
                        placeholder="Satış Asistanı"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />

                    <Input
                        id="agent-tone"
                        label="Ton"
                        placeholder="friendly, expert, concise"
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                    />

                    <label className="mb-4 block text-sm">
                        <span className="mb-1.5 block font-medium text-text-muted">Dil</span>
                        <select
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none focus:border-brand"
                        >
                            {LANGUAGES.map((l) => (
                                <option key={l.value} value={l.value}>
                                    {l.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <Input
                        id="agent-goals"
                        label="Hedefler (virgülle ayır, opsiyonel)"
                        placeholder="demo ayarla, itirazları yanıtla"
                        value={goals}
                        onChange={(e) => setGoals(e.target.value)}
                    />

                    <label className="mb-4 block text-sm">
                        <span className="mb-1.5 block font-medium text-text-muted">Avatar sağlayıcı</span>
                        <select
                            value={avatarProvider}
                            onChange={(e) => setAvatarProvider(e.target.value)}
                            className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none focus:border-brand"
                        >
                            {AVATAR_PROVIDERS.map((p) => (
                                <option key={p.value} value={p.value}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="mb-4">
                        <span className="mb-1.5 block text-sm font-medium text-text-muted">Ekran modları</span>
                        <div className="flex flex-col gap-2">
                            {SCREEN_MODES.map((m) => (
                                <label key={m.value} className="flex items-center gap-2 text-sm text-text">
                                    <input
                                        type="checkbox"
                                        checked={screenModes.includes(m.value)}
                                        onChange={() => toggleScreenMode(m.value)}
                                        className="h-4 w-4 rounded border-border accent-[var(--color-brand)]"
                                    />
                                    {m.label}
                                </label>
                            ))}
                        </div>
                    </div>

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

export function Agents() {
    const workspace = useAuthStore((s) => s.workspace);
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [showModal, setShowModal] = useState(false);
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

    const { data: agents } = useQuery({
        queryKey: ['agents', productId],
        queryFn: () => agentsApi.list(productId),
        enabled: !!productId
    });

    function onCreated() {
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: ['agents', productId] });
    }

    if (products && products.length === 0) {
        return (
            <div>
                <h1 className="text-xl font-semibold text-text">Agents</h1>
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
                    <h1 className="text-xl font-semibold text-text">Agents</h1>
                    <p className="mt-1 text-sm text-text-muted">
                        Ürününüz için AI satış temsilcisi kurun ve yayına alın.
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
                    <Button onClick={() => setShowModal(true)} disabled={!productId}>
                        <Plus size={16} />
                        Yeni agent
                    </Button>
                </div>
            </div>

            {agents?.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <Bot size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Henüz agent yok.</p>
                    <Button size="sm" variant="secondary" className="mt-4" onClick={() => setShowModal(true)}>
                        İlk agent'ını oluştur
                    </Button>
                </div>
            )}

            {agents?.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {agents.map((a) => (
                        <Link
                            key={a._id}
                            to={`/agents/${a._id}`}
                            className="group rounded-[var(--radius-card)] border border-border bg-surface p-5 transition-colors hover:border-brand/50"
                        >
                            <div className="mb-3 flex items-center justify-between">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-brand-light">
                                    <Bot size={16} />
                                </span>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[a.status]}`}>
                                    {STATUS_LABEL[a.status]}
                                </span>
                            </div>
                            <h3 className="font-semibold text-text group-hover:text-brand-light">{a.name}</h3>
                            <p className="mt-1 text-xs text-text-muted">{a.persona?.language?.toUpperCase() || 'EN'} · {a.avatarProvider}</p>
                        </Link>
                    ))}
                </div>
            )}

            {showModal && productId && (
                <NewAgentModal productId={productId} onClose={() => setShowModal(false)} onCreated={onCreated} />
            )}
        </div>
    );
}
