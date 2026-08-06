import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Button, Input } from '@repo/ui';
import { Key, Plus, Trash2, Copy, Check, AlertCircle } from 'lucide-react';
import { apiKeysApi } from '../lib/api.js';
import { SettingsTabs } from '../lib/SettingsTabs.jsx';

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

export function SettingsApiKeys() {
    const queryClient = useQueryClient();
    const [newKey, setNewKey] = useState(null);
    const [error, setError] = useState('');
    const {
        register,
        handleSubmit,
        reset,
        formState: { isSubmitting }
    } = useForm({ defaultValues: { name: '' } });

    const { data: keys, isLoading } = useQuery({
        queryKey: ['api-keys'],
        queryFn: () => apiKeysApi.list()
    });

    async function onSubmit(values) {
        setError('');
        try {
            const created = await apiKeysApi.create({ name: values.name });
            setNewKey(created);
            reset();
            queryClient.invalidateQueries({ queryKey: ['api-keys'] });
        } catch (err) {
            setError(err.message);
        }
    }

    async function onRevoke(id) {
        await apiKeysApi.remove(id);
        queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    }

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-xl font-semibold text-text">Ayarlar</h1>
                <p className="mt-1 text-sm text-text-muted">SDK ve API entegrasyonları için anahtarları yönet.</p>
            </div>

            <SettingsTabs />

            <form onSubmit={handleSubmit(onSubmit)} className="mb-6 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[220px]">
                    <Input id="key-name" label="Yeni anahtar adı" placeholder="Örn. Production widget" required {...register('name')} />
                </div>
                <Button type="submit" disabled={isSubmitting} className="mb-4">
                    <Plus size={16} />
                    {isSubmitting ? 'Oluşturuluyor…' : 'Anahtar oluştur'}
                </Button>
            </form>

            {error && (
                <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                    <AlertCircle size={16} className="shrink-0" />
                    {error}
                </div>
            )}

            {newKey && (
                <div className="mb-6 rounded-[var(--radius-card)] border border-brand/30 bg-brand/5 p-5">
                    <h3 className="mb-2 text-sm font-semibold text-text">Yeni anahtarın — bir daha gösterilmeyecek</h3>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded-[var(--radius-input)] border border-border bg-bg px-3 py-2 text-xs text-text">
                            {newKey.plainKey}
                        </code>
                        <CopyButton text={newKey.plainKey} />
                    </div>
                </div>
            )}

            {isLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}

            {keys?.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border py-16 text-center">
                    <Key size={28} className="mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">Henüz API anahtarı yok.</p>
                </div>
            )}

            {keys?.length > 0 && (
                <div className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                    {keys.map((k) => (
                        <div key={k.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                            <div className="flex items-center gap-3">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised text-text-muted">
                                    <Key size={15} />
                                </span>
                                <div>
                                    <p className="text-sm font-medium text-text">{k.name}</p>
                                    <p className="text-xs text-text-muted">{k.prefix}••••••••</p>
                                </div>
                            </div>
                            <button
                                onClick={() => onRevoke(k.id)}
                                title="Anahtarı iptal et"
                                className="text-text-muted transition-colors hover:text-red-400"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
