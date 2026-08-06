import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@repo/ui';
import { EmbedConfigInput, isValidEmbedDomainPattern } from '@repo/contracts';
import { ArrowLeft, MessageCircle, Plus, X, Copy, Check, AlertCircle } from 'lucide-react';
import { agentsApi } from '../lib/api.js';

function CopyButton({ text }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() => {
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1.5 rounded-[var(--radius-input)] border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-brand/50"
        >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Kopyalandı' : 'Kopyala'}
        </button>
    );
}

function DomainList({ domains, onChange }) {
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    function addDomain() {
        const v = value.trim().toLowerCase();
        if (!v) return;
        if (!isValidEmbedDomainPattern(v)) {
            setError('Geçersiz domain deseni (örn. acme.com veya *.acme.com)');
            return;
        }
        if (domains.includes(v)) {
            setError('Bu domain zaten eklendi');
            return;
        }
        setError('');
        onChange([...domains, v]);
        setValue('');
    }

    return (
        <div>
            <div className="flex gap-2">
                <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            addDomain();
                        }
                    }}
                    placeholder="acme.com veya *.acme.com"
                    className="h-10 flex-1 rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none focus:border-brand"
                />
                <Button type="button" variant="secondary" onClick={addDomain}>
                    <Plus size={15} />
                    Ekle
                </Button>
            </div>
            {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}

            {domains.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {domains.map((d) => (
                        <span
                            key={d}
                            className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs text-text"
                        >
                            {d}
                            <button
                                type="button"
                                onClick={() => onChange(domains.filter((x) => x !== d))}
                                className="text-text-muted hover:text-red-400"
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function LauncherPreview({ theme, launcher, greeting }) {
    const positionClass = launcher.position === 'bottom-left' ? 'left-6' : 'right-6';
    return (
        <div className="relative h-80 overflow-hidden rounded-[var(--radius-card)] border border-border bg-[#f4f4f6]">
            <div className={`absolute bottom-6 ${positionClass} flex flex-col items-end gap-2`}>
                {greeting && (
                    <div className="max-w-[220px] rounded-2xl rounded-br-sm bg-white px-4 py-2.5 text-sm text-[#111] shadow-lg">
                        {greeting}
                    </div>
                )}
                <button
                    type="button"
                    style={{ backgroundColor: theme.primaryColor }}
                    className="flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-lg"
                >
                    <MessageCircle size={18} />
                    {launcher.label}
                </button>
            </div>
        </div>
    );
}

export function EmbedStudio() {
    const { id } = useParams();
    const queryClient = useQueryClient();
    const [saveError, setSaveError] = useState('');
    const [saved, setSaved] = useState(null);

    const { data: agent } = useQuery({ queryKey: ['agent', id], queryFn: () => agentsApi.get(id) });
    const { data: current, isLoading } = useQuery({ queryKey: ['agent-embed', id], queryFn: () => agentsApi.getEmbed(id) });

    const {
        register,
        control,
        handleSubmit,
        reset,
        watch,
        formState: { errors, isSubmitting }
    } = useForm({ resolver: zodResolver(EmbedConfigInput) });

    useEffect(() => {
        if (current) {
            reset({
                theme: current.theme,
                launcher: current.launcher,
                greeting: current.greeting || '',
                micAutoPrompt: current.micAutoPrompt,
                rateCaps: current.rateCaps,
                domains: (current.domains || []).map((d) => d.domain)
            });
            if (current.snippet) setSaved(current);
        }
    }, [current, reset]);

    const watched = watch();

    async function onSubmit(values) {
        setSaveError('');
        try {
            const result = await agentsApi.saveEmbed(id, values);
            setSaved(result);
            queryClient.invalidateQueries({ queryKey: ['agent-embed', id] });
        } catch (err) {
            setSaveError(err.message);
        }
    }

    if (isLoading || !watched.theme) return <p className="text-sm text-text-muted">Yükleniyor…</p>;

    return (
        <div>
            <Link
                to={`/agents/${id}`}
                className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
            >
                <ArrowLeft size={14} />
                {agent?.name || 'Agent'}
            </Link>

            <div className="mb-8">
                <h1 className="text-xl font-semibold text-text">Embed Studio</h1>
                <p className="mt-1 text-sm text-text-muted">Widget görünümünü ve izinli domain listesini yönet.</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="flex flex-col gap-6">
                    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                        <h3 className="mb-4 text-sm font-semibold text-text">Tema</h3>
                        <label className="mb-4 block text-sm">
                            <span className="mb-1.5 block font-medium text-text-muted">Ana renk</span>
                            <div className="flex items-center gap-2">
                                <input type="color" {...register('theme.primaryColor')} className="h-10 w-14 rounded-[var(--radius-input)] border border-border bg-bg" />
                                <input
                                    {...register('theme.primaryColor')}
                                    className="h-10 flex-1 rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none focus:border-brand"
                                />
                            </div>
                            {errors.theme?.primaryColor && <p className="mt-1.5 text-xs text-red-400">{errors.theme.primaryColor.message}</p>}
                        </label>

                        <label className="block text-sm">
                            <span className="mb-1.5 block font-medium text-text-muted">Görünüm modu</span>
                            <select
                                {...register('theme.mode')}
                                className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none focus:border-brand"
                            >
                                <option value="auto">Otomatik</option>
                                <option value="light">Açık</option>
                                <option value="dark">Koyu</option>
                            </select>
                        </label>
                    </div>

                    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                        <h3 className="mb-4 text-sm font-semibold text-text">Başlatıcı</h3>
                        <label className="mb-4 block text-sm">
                            <span className="mb-1.5 block font-medium text-text-muted">Konum</span>
                            <select
                                {...register('launcher.position')}
                                className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none focus:border-brand"
                            >
                                <option value="bottom-right">Sağ alt</option>
                                <option value="bottom-left">Sol alt</option>
                            </select>
                        </label>
                        <Input
                            id="launcher-label"
                            label="Buton metni"
                            error={errors.launcher?.label?.message}
                            {...register('launcher.label')}
                        />
                        <label className="mb-4 block text-sm">
                            <span className="mb-1.5 block font-medium text-text-muted">Karşılama mesajı (opsiyonel)</span>
                            <textarea
                                rows={2}
                                {...register('greeting')}
                                className="w-full resize-none rounded-[var(--radius-input)] border border-border bg-bg px-3 py-2 text-[13.5px] text-text outline-none focus:border-brand"
                            />
                            {errors.greeting && <p className="mt-1.5 text-xs text-red-400">{errors.greeting.message}</p>}
                        </label>
                        <label className="flex items-center gap-2 text-sm text-text">
                            <input type="checkbox" {...register('micAutoPrompt')} className="h-4 w-4 rounded border-border accent-[var(--color-brand)]" />
                            Mikrofon iznini otomatik iste
                        </label>
                    </div>

                    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                        <h3 className="mb-4 text-sm font-semibold text-text">İzinli domainler</h3>
                        <Controller
                            name="domains"
                            control={control}
                            render={({ field }) => <DomainList domains={field.value || []} onChange={field.onChange} />}
                        />
                    </div>

                    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
                        <h3 className="mb-4 text-sm font-semibold text-text">Oran sınırları (saatlik)</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <Input
                                id="rate-ip"
                                label="IP başına"
                                type="number"
                                {...register('rateCaps.sessionsPerIpPerHour', { valueAsNumber: true })}
                            />
                            <Input
                                id="rate-origin"
                                label="Domain başına"
                                type="number"
                                {...register('rateCaps.sessionsPerOriginPerHour', { valueAsNumber: true })}
                            />
                        </div>
                    </div>

                    {saveError && (
                        <div className="flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                            <AlertCircle size={16} className="shrink-0" />
                            {saveError}
                        </div>
                    )}

                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? 'Kaydediliyor…' : 'Kaydet'}
                    </Button>
                </div>

                <div className="flex flex-col gap-6">
                    <div>
                        <h3 className="mb-3 text-sm font-semibold text-text">Canlı önizleme</h3>
                        <LauncherPreview theme={watched.theme} launcher={watched.launcher} greeting={watched.greeting} />
                    </div>

                    {saved?.snippet && (
                        <div className="rounded-[var(--radius-card)] border border-brand/30 bg-brand/5 p-5">
                            <h3 className="mb-2 text-sm font-semibold text-text">Embed snippet</h3>
                            <div className="flex items-start gap-2">
                                <pre className="flex-1 overflow-x-auto rounded-[var(--radius-input)] border border-border bg-bg px-3 py-2 text-xs text-text-muted">
                                    {saved.snippet}
                                </pre>
                                <CopyButton text={saved.snippet} />
                            </div>
                        </div>
                    )}
                </div>
            </form>
        </div>
    );
}
