import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AgentConfigInput, MAX_ROOM_PARTICIPANTS } from '@repo/contracts';
import { Button, Input } from '@repo/ui';
import { Plus, Bot, X, AlertCircle } from 'lucide-react';
import { productsApi, agentsApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { productSelectionKey, rememberSelection, resolveRememberedSelection } from '../lib/selectionMemory.js';

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

// Kept in sync by hand with packages/agent/src/persona-archetypes.js's keys —
// that file owns the actual behavior rules, this is only display copy.
// 'custom' isn't a real archetype block (persona.js's renderArchetype()
// returns '' for it) — it's the escape hatch that reveals the free-text
// Tone input below, preserving today's exact hand-written-tone behavior.
const ARCHETYPES = [
    { value: 'marketing', label: 'Pazarlama', description: 'İkna edici, hikaye anlatan, fayda odaklı bir satış sesi.' },
    { value: 'technical', label: 'Teknik', description: 'Net, kanıta dayalı, mühendis diliyle konuşan bir satış sesi.' },
    { value: 'custom', label: 'Custom', description: 'Kendi ton tanımını yaz (serbest metin).' }
];

const DEFAULT_PERSONA_TONE = 'consultative, persuasive, concise, outcome-focused';
const DEFAULT_PERSONA_GOALS = [
    'Musterinin ihtiyacini hizlica anlamak',
    'Urun degerini is sonucuna baglayarak anlatmak',
    'Uygun oldugunda demo veya sonraki adima ilerletmek'
].join(', ');

/** Form values use a flat tone/language/goalsText shape; this reshapes + validates against the real API contract. */
function buildAgentFormSchema(productId) {
    return z.preprocess((data) => {
        const goals = typeof data?.goalsText === 'string'
            ? data.goalsText.split(',').map((g) => g.trim()).filter(Boolean)
            : [];
        return {
            productId,
            name: data?.name,
            persona: {
                tone: data?.tone,
                language: data?.language,
                goals,
                guardrails: [],
                archetype: data?.archetype
            },
            avatarProvider: data?.avatarProvider,
            screenModes: data?.screenModes || [],
            maxParticipants: data?.maxParticipants,
            preCallSurveyEnabled: Boolean(data?.preCallSurveyEnabled)
        };
    }, AgentConfigInput);
}

function NewAgentModal({ productId, onClose, onCreated }) {
    const [error, setError] = useState('');
    const {
        register,
        handleSubmit,
        control,
        watch,
        formState: { errors, isSubmitting }
    } = useForm({
        resolver: zodResolver(buildAgentFormSchema(productId)),
        defaultValues: {
            name: '',
            // 'marketing' by default — a curated, tested character out of the
            // box. This is a UI-layer default only; the DB/contract default is
            // 'custom' (safe fallback for agents that predate this field).
            archetype: 'marketing',
            tone: DEFAULT_PERSONA_TONE,
            language: 'tr',
            goalsText: DEFAULT_PERSONA_GOALS,
            avatarProvider: 'voice-only',
            screenModes: ['guided-tour', 'customer-share'],
            maxParticipants: 1,
            preCallSurveyEnabled: false
        }
    });
    const archetype = watch('archetype');

    async function onSubmit(agent) {
        setError('');
        try {
            const created = await agentsApi.create(agent);
            onCreated(created);
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-6">
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-text">Yeni agent</h2>
                    <button onClick={onClose} aria-label="Kapat" className="text-text-muted hover:text-text">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)}>
                    <Input
                        id="agent-name"
                        label="Agent adı"
                        placeholder="Satış Asistanı"
                        error={errors.name?.message}
                        {...register('name')}
                    />

                    <Controller
                        name="archetype"
                        control={control}
                        render={({ field }) => (
                            <div className="mb-4">
                                <span className="mb-1.5 block text-sm font-medium text-text-muted">Karakter</span>
                                <div className="grid grid-cols-3 gap-2">
                                    {ARCHETYPES.map((a) => (
                                        <button
                                            key={a.value}
                                            type="button"
                                            onClick={() => field.onChange(a.value)}
                                            title={a.description}
                                            aria-pressed={field.value === a.value}
                                            className={`rounded-[var(--radius-input)] border px-2 py-2 text-left text-xs transition-colors ${
                                                field.value === a.value
                                                    ? 'border-brand bg-brand/10 text-text'
                                                    : 'border-border bg-bg text-text-muted hover:border-brand/50'
                                            }`}
                                        >
                                            <span className="block font-semibold">{a.label}</span>
                                        </button>
                                    ))}
                                </div>
                                <p className="mt-1.5 text-xs text-text-muted">
                                    {ARCHETYPES.find((a) => a.value === field.value)?.description}
                                </p>
                            </div>
                        )}
                    />

                    {archetype === 'custom' && (
                        <Input
                            id="agent-tone"
                            label="Ton"
                            placeholder={DEFAULT_PERSONA_TONE}
                            {...register('tone')}
                        />
                    )}

                    <label className="mb-4 block text-sm">
                        <span className="mb-1.5 block font-medium text-text-muted">Dil</span>
                        <select
                            {...register('language')}
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
                        placeholder={DEFAULT_PERSONA_GOALS}
                        {...register('goalsText')}
                    />

                    <Input
                        id="agent-max-participants"
                        type="number"
                        min={1}
                        max={MAX_ROOM_PARTICIPANTS}
                        label="Aynı anda kaç müşteriye sunum yapsın? (1 = birebir; agent bu sayıya dahil değil)"
                        error={errors.maxParticipants?.message}
                        {...register('maxParticipants')}
                    />

                    <label className="mb-4 block text-sm">
                        <span className="mb-1.5 block font-medium text-text-muted">Avatar sağlayıcı</span>
                        <select
                            {...register('avatarProvider')}
                            className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none focus:border-brand"
                        >
                            {AVATAR_PROVIDERS.map((p) => (
                                <option key={p.value} value={p.value}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <Controller
                        name="screenModes"
                        control={control}
                        render={({ field }) => (
                            <div className="mb-4">
                                <span className="mb-1.5 block text-sm font-medium text-text-muted">Ekran modları</span>
                                <div className="flex flex-col gap-2">
                                    {SCREEN_MODES.map((m) => (
                                        <label key={m.value} className="flex items-center gap-2 text-sm text-text">
                                            <input
                                                type="checkbox"
                                                checked={field.value.includes(m.value)}
                                                onChange={() =>
                                                    field.onChange(
                                                        field.value.includes(m.value)
                                                            ? field.value.filter((v) => v !== m.value)
                                                            : [...field.value, m.value]
                                                    )
                                                }
                                                className="h-4 w-4 rounded border-border accent-[var(--color-brand)]"
                                            />
                                            {m.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    />

                    {Number(watch('maxParticipants')) <= 1 && (
                        <label className="mb-4 flex items-start gap-2 text-sm text-text">
                            <input
                                type="checkbox"
                                {...register('preCallSurveyEnabled')}
                                className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--color-brand)]"
                            />
                            <span>
                                Görüşmeye ön anketle başla
                                <span className="mt-0.5 block text-xs text-text-muted">
                                    Yalnız birebir görüşmelerde. Ziyaretçi kısa bir yapay zekâ anketi
                                    doldurur, agent ona özel bir tur planı izler.
                                </span>
                            </span>
                        </label>
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
                            {isSubmitting ? 'Oluşturuluyor…' : 'Oluştur'}
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
        const resolved = resolveRememberedSelection({ currentId: productId, items: products, storageKey: productSelectionKey(workspace?.id) });
        if (resolved && resolved !== productId) setSearchParams({ product: resolved }, { replace: true });
    }, [productId, products, setSearchParams, workspace?.id]);

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
                            onChange={(e) => {
                                rememberSelection(productSelectionKey(workspace?.id), e.target.value);
                                setSearchParams({ product: e.target.value });
                            }}
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
