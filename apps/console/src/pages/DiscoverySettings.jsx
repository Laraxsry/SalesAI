import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircleQuestion } from 'lucide-react';
import { productsApi } from '../lib/api.js';

const FIELDS = [
    { id: 'industry', label: 'Çalıştığı sektör', effect: 'Uygun demo ve fiyat anlatımı' },
    { id: 'teamSize', label: 'Ekip büyüklüğü', effect: 'İhtiyaç ve kullanım ölçeği' },
    { id: 'primaryGoal', label: 'Öncelikli hedefi', effect: 'Gösterilecek demo yolu' }
];
const PRIORITIES = [
    { value: 'off', label: 'Sorma' },
    { value: 'helpful', label: 'Faydalı' },
    { value: 'important', label: 'Önemli' }
];

export function DiscoverySettings({ product }) {
    const queryClient = useQueryClient();
    const [enabled, setEnabled] = useState(product.discovery?.enabled ?? false);
    const [priorities, setPriorities] = useState(product.discovery?.priorities ?? {
        industry: 'off', teamSize: 'off', primaryGoal: 'off'
    });
    const [saved, setSaved] = useState(false);
    const mutation = useMutation({
        mutationFn: (payload) => productsApi.updateDiscovery(product.id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['product', product.id] });
            setSaved(true);
        }
    });
    const selected = FIELDS.filter((field) => priorities[field.id] !== 'off');

    return (
        <section className="mt-8 rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <div className="flex items-center gap-2">
                <MessageCircleQuestion size={18} className="text-brand-light" />
                <h2 className="text-lg font-medium text-text">Görüşme içi keşif soruları</h2>
            </div>
            <p className="mt-2 text-sm text-text-muted">
                Temsilci, müşteri sorusunu yanıtladıktan sonra yalnızca gerçekten ihtiyaç duyduğu bilgiyi
                kısa bir soruyla isteyebilir. Bildiği bir bilgiyi tekrar sormaz; müşteri araya girerse durur.
            </p>
            <label className="mt-5 flex items-center gap-3 text-sm text-text">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => { setEnabled(event.target.checked); setSaved(false); }}
                    className="h-4 w-4 accent-brand"
                />
                Bu ürün için keşif sorularına izin ver
            </label>
            <div className="mt-4 space-y-3">
                {FIELDS.map((field) => (
                    <div key={field.id} className="flex flex-col gap-2 rounded-xl border border-border/70 bg-bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm font-medium text-text">{field.label}</p>
                            <p className="text-xs text-text-muted">{field.effect}</p>
                        </div>
                        <select
                            aria-label={`${field.label} önemi`}
                            value={priorities[field.id]}
                            onChange={(event) => {
                                setPriorities((current) => ({ ...current, [field.id]: event.target.value }));
                                setSaved(false);
                            }}
                            className="rounded-[var(--radius-input)] border border-input-border bg-input-bg px-3 py-2 text-sm text-text"
                        >
                            {PRIORITIES.map((priority) => (
                                <option key={priority.value} value={priority.value}>{priority.label}</option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>
            <p className="mt-4 text-xs text-text-muted">
                {enabled && selected.length
                    ? `Önizleme: Temsilci ${selected.map((field) => field.label.toLowerCase()).join(', ')} bilgisini yalnızca görüşme için gerekliyse sorabilir. “Önemli” bir alan bile müşterinin yanıtını zorunlu kılmaz.`
                    : 'Keşif soruları kapalıdır. Açmak için en az bir alanı Faydalı veya Önemli seçin.'}
            </p>
            <p className="mt-2 text-xs text-text-muted">
                Bu deneysel özellik ayrıca sunucu tarafındaki pilot anahtarına bağlıdır; burada izin vermek tek başına canlı görüşmelerde açmaz.
            </p>
            {mutation.error && <p role="alert" className="mt-3 text-sm text-red-400">{mutation.error.message}</p>}
            {saved && <p role="status" className="mt-3 text-sm text-brand-light">Ayarlar kaydedildi.</p>}
            <button
                type="button"
                disabled={mutation.isPending || (enabled && selected.length === 0)}
                onClick={() => mutation.mutate({ enabled, priorities })}
                className="mt-4 rounded-[var(--radius-button)] bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
                {mutation.isPending ? 'Kaydediliyor…' : 'Keşif ayarlarını kaydet'}
            </button>
        </section>
    );
}
