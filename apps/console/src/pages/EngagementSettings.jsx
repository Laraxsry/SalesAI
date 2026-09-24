import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit } from 'lucide-react';
import { productsApi } from '../lib/api.js';

const DEFAULTS = {
    multiAgentAnalysisEnabled: false,
    participantMemoryEnabled: false,
    adaptiveSurveyEnabled: false,
    dynamicDemoEnabled: false,
    leadCaptureEnabled: false,
    captureFields: {
        name: 'optional', email: 'recommended', phone: 'optional', company: 'optional',
        meetingTime: 'optional', companyQuestion: 'recommended'
    },
    scheduling: { enabled: false, timezone: 'UTC', durationMinutes: 30 }
};

const CAPABILITIES = [
    ['multiAgentAnalysisEnabled', 'Uzman mini-agent analizi', 'Konuşmayı arka planda uzman görevlere ayırır.'],
    ['participantMemoryEnabled', 'Kişi bazlı konuşma hafızası', 'Tekrarı azaltır; katılımcıların bağlamını birbirine karıştırmaz.'],
    ['adaptiveSurveyEnabled', 'Akıllı görüşme içi survey', 'Yalnızca ihtiyaç olduğunda kısa bir arayüz sorusu önerebilir.'],
    ['dynamicDemoEnabled', 'Dinamik demo rotası', 'Kabul edilen rota üzerinden ilgili ürün ekranını gösterebilir.'],
    ['leadCaptureEnabled', 'Onaylı lead verisi', 'Açık teyit verilen iletişim ve görüşme bilgilerini kaydedebilir.']
];

const CAPTURE_FIELDS = [
    ['name', 'Ad'], ['email', 'E-posta'], ['phone', 'Telefon'], ['company', 'Şirket'],
    ['meetingTime', 'Sonraki görüşme zamanı'], ['companyQuestion', 'Şirkete iletilecek soru']
];

const POLICIES = [
    ['off', 'Kapalı'], ['optional', 'Opsiyonel'], ['recommended', 'Önerilen'],
    ['required_before_close', 'Kapanıştan önce gerekli']
];

export function EngagementSettings({ product }) {
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState(() => ({
        ...DEFAULTS,
        ...product.engagementSettings,
        captureFields: { ...DEFAULTS.captureFields, ...product.engagementSettings?.captureFields },
        scheduling: { ...DEFAULTS.scheduling, ...product.engagementSettings?.scheduling }
    }));
    const [saved, setSaved] = useState(false);
    const mutation = useMutation({
        mutationFn: (payload) => productsApi.updateEngagement(product.id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['product', product.id] });
            setSaved(true);
        }
    });

    function setCapability(key, value) {
        setSaved(false);
        setSettings((current) => ({
            ...current,
            [key]: value,
            ...(key === 'multiAgentAnalysisEnabled' && !value
                ? { participantMemoryEnabled: false } : {})
        }));
    }

    return (
        <section className="mt-8 rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <div className="flex items-center gap-2">
                <BrainCircuit size={18} className="text-brand-light" />
                <h2 className="text-lg font-medium text-text">Akıllı görüşme orkestrasyonu</h2>
            </div>
            <p className="mt-2 text-sm text-text-muted">
                Bu ürün için arka plan uzmanlarını ve satış çıktısı politikalarını yönetin.
                Sunucudaki global anahtarlar acil kapatma sınırı olarak ayrıca geçerlidir.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {CAPABILITIES.map(([key, label, description]) => (
                    <label key={key} className="flex gap-3 rounded-xl border border-border/70 bg-bg-muted p-3">
                        <input
                            type="checkbox"
                            checked={settings[key]}
                            disabled={key === 'participantMemoryEnabled'
                                && !settings.multiAgentAnalysisEnabled}
                            onChange={(event) => setCapability(key, event.target.checked)}
                            className="mt-1 h-4 w-4 accent-brand"
                        />
                        <span>
                            <span className="block text-sm font-medium text-text">{label}</span>
                            <span className="block text-xs text-text-muted">{description}</span>
                        </span>
                    </label>
                ))}
            </div>

            <h3 className="mt-6 text-sm font-medium text-text">Toplanabilecek satış bilgileri</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {CAPTURE_FIELDS.map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 text-sm text-text">
                        <span>{label}</span>
                        <select
                            value={settings.captureFields[key]}
                            onChange={(event) => {
                                setSaved(false);
                                setSettings((current) => ({
                                    ...current,
                                    captureFields: {
                                        ...current.captureFields, [key]: event.target.value
                                    }
                                }));
                            }}
                            className="rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-xs text-text"
                        >
                            {POLICIES.map(([value, text]) => (
                                <option key={value} value={value}>{text}</option>
                            ))}
                        </select>
                    </label>
                ))}
            </div>

            <div className="mt-6 rounded-xl border border-border/70 bg-bg-muted p-3">
                <label className="flex items-center gap-3 text-sm text-text">
                    <input
                        type="checkbox"
                        checked={settings.scheduling.enabled}
                        onChange={(event) => {
                            setSaved(false);
                            setSettings((current) => ({
                                ...current,
                                scheduling: { ...current.scheduling, enabled: event.target.checked }
                            }));
                        }}
                        className="h-4 w-4 accent-brand"
                    />
                    Görüşme planlamaya izin ver
                </label>
                {settings.scheduling.enabled && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="text-xs text-text-muted">
                            IANA saat dilimi
                            <input
                                value={settings.scheduling.timezone}
                                onChange={(event) => {
                                    setSaved(false);
                                    setSettings((current) => ({
                                        ...current,
                                        scheduling: { ...current.scheduling, timezone: event.target.value }
                                    }));
                                }}
                                className="mt-1 w-full rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-sm text-text"
                            />
                        </label>
                        <label className="text-xs text-text-muted">
                            Varsayılan süre (dakika)
                            <input
                                type="number"
                                min="5"
                                max="480"
                                value={settings.scheduling.durationMinutes}
                                onChange={(event) => {
                                    setSaved(false);
                                    setSettings((current) => ({
                                        ...current,
                                        scheduling: {
                                            ...current.scheduling,
                                            durationMinutes: Number(event.target.value)
                                        }
                                    }));
                                }}
                                className="mt-1 w-full rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-sm text-text"
                            />
                        </label>
                    </div>
                )}
            </div>

            {mutation.error && (
                <p role="alert" className="mt-3 text-sm text-red-400">{mutation.error.message}</p>
            )}
            {saved && <p role="status" className="mt-3 text-sm text-brand-light">Ayarlar kaydedildi.</p>}
            <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(settings)}
                className="mt-4 rounded-[var(--radius-button)] bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
                {mutation.isPending ? 'Kaydediliyor…' : 'Orkestrasyon ayarlarını kaydet'}
            </button>
        </section>
    );
}
