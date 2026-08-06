import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@repo/ui';
import { Check, CreditCard, ExternalLink } from 'lucide-react';
import { billingApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { SettingsTabs } from '../lib/SettingsTabs.jsx';

function formatPrice(amount) {
    if (!amount) return 'Ücretsiz';
    return `$${amount}/ay`;
}

const FEATURE_LABELS = {
    allowedAvatarProviders: (v) => `Avatar: ${Array.isArray(v) ? v.join(', ') : v}`,
    allowedScreenModes: (v) => `Ekran modları: ${Array.isArray(v) ? v.join(', ') : v}`,
    seats: (v) => `${v} koltuk`,
    embedDomains: (v) => `${v} embed domain`,
    apiAccess: (v) => (v ? 'API erişimi' : null)
};

function planFeatureList(features) {
    if (!features) return [];
    if (Array.isArray(features)) return features;
    return Object.entries(features)
        .map(([key, value]) => FEATURE_LABELS[key]?.(value) ?? null)
        .filter(Boolean);
}

export function SettingsBilling() {
    const workspace = useAuthStore((s) => s.workspace);
    const [busyPlan, setBusyPlan] = useState('');
    const [portalBusy, setPortalBusy] = useState(false);
    const [error, setError] = useState('');

    const { data: plans, isLoading: plansLoading } = useQuery({
        queryKey: ['billing-plans'],
        queryFn: () => billingApi.plans()
    });

    const { data: subscription, isLoading: subLoading } = useQuery({
        queryKey: ['billing-subscription', workspace?.id],
        queryFn: () => billingApi.subscription(),
        enabled: !!workspace?.id
    });

    const { data: usage } = useQuery({
        queryKey: ['billing-usage', workspace?.id],
        queryFn: () => billingApi.usage(),
        enabled: !!workspace?.id
    });

    async function onSelectPlan(planKey) {
        setError('');
        setBusyPlan(planKey);
        try {
            const { checkoutUrl } = await billingApi.checkout(planKey);
            window.location.href = checkoutUrl;
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyPlan('');
        }
    }

    async function onOpenPortal() {
        setError('');
        setPortalBusy(true);
        try {
            const { portalUrl } = await billingApi.portal();
            window.location.href = portalUrl;
        } catch (err) {
            setError(err.message);
        } finally {
            setPortalBusy(false);
        }
    }

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-xl font-semibold text-text">Ayarlar</h1>
                <p className="mt-1 text-sm text-text-muted">Plan, kullanım ve fatura bilgilerini yönet.</p>
            </div>

            <SettingsTabs />

            {!subLoading && subscription && (
                <section className="mb-8 rounded-[var(--radius-card)] border border-brand/30 bg-brand/5 p-5">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-xs font-semibold uppercase text-brand-light">Mevcut plan</p>
                            <p className="mt-1 text-lg font-bold text-text">{subscription.planName}</p>
                            <p className="mt-0.5 text-xs text-text-muted">
                                Durum: {subscription.status}
                                {subscription.cancelAtPeriodEnd && ' · dönem sonunda iptal edilecek'}
                            </p>
                        </div>
                        <Button variant="secondary" onClick={onOpenPortal} disabled={portalBusy}>
                            <CreditCard size={16} />
                            {portalBusy ? 'Açılıyor…' : 'Faturalama portalı'}
                        </Button>
                    </div>
                </section>
            )}

            {usage && (
                <section className="mb-8">
                    <h2 className="mb-3 text-sm font-semibold text-text-muted">Kullanım</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        {Object.entries(usage.meters || usage).map(([key, meter]) => {
                            if (typeof meter !== 'object' || meter === null) return null;
                            const used = meter.used ?? 0;
                            const limit = meter.limit ?? meter.quota ?? 0;
                            const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                            return (
                                <div key={key} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
                                    <p className="mb-2 text-xs font-medium capitalize text-text-muted">{key}</p>
                                    <p className="mb-2 text-sm text-text">
                                        {used} {limit ? `/ ${limit}` : ''}
                                    </p>
                                    {limit > 0 && (
                                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                                            <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            <section>
                <h2 className="mb-3 text-sm font-semibold text-text-muted">Planlar</h2>
                {plansLoading && <p className="text-sm text-text-muted">Yükleniyor…</p>}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {plans?.map((plan) => {
                        const isCurrent = subscription?.planKey === plan.key;
                        return (
                            <div
                                key={plan.key}
                                className={`rounded-[var(--radius-card)] border p-5 ${
                                    isCurrent ? 'border-brand bg-brand/5' : 'border-border bg-surface'
                                }`}
                            >
                                <h3 className="font-semibold text-text">{plan.name}</h3>
                                <p className="mt-1 text-2xl font-bold text-text">{formatPrice(plan.priceMonthly)}</p>
                                <ul className="mt-4 flex flex-col gap-1.5">
                                    {planFeatureList(plan.features).map((f) => (
                                        <li key={f} className="flex items-center gap-1.5 text-xs text-text-muted">
                                            <Check size={12} className="shrink-0 text-brand-light" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    variant={isCurrent ? 'secondary' : 'primary'}
                                    className="mt-5 w-full"
                                    disabled={isCurrent || busyPlan === plan.key}
                                    onClick={() => onSelectPlan(plan.key)}
                                >
                                    {isCurrent ? 'Mevcut plan' : busyPlan === plan.key ? 'Yönlendiriliyor…' : 'Bu planı seç'}
                                </Button>
                            </div>
                        );
                    })}
                </div>
            </section>

            {error && (
                <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                    <ExternalLink size={16} className="shrink-0" />
                    {error}
                </div>
            )}
        </div>
    );
}
