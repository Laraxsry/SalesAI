import { Logo } from '@repo/ui';
import { Sparkles, Mic, LineChart, ScreenShare } from 'lucide-react';

const FEATURES = [
    { icon: Mic, text: 'Sesli + görüntülü AI satış temsilcisi' },
    { icon: ScreenShare, text: 'Canlı ekran turu ve co-browsing' },
    { icon: LineChart, text: 'Konuşma analitiği ve lead skorlama' }
];

/** Two-column shell shared by the login and register screens. */
export function AuthLayout({ children }) {
    return (
        <div className="grid min-h-screen lg:grid-cols-2">
            <div className="relative hidden flex-col justify-between overflow-hidden bg-surface p-12 lg:flex">
                <div
                    className="pointer-events-none absolute inset-0 opacity-40"
                    style={{
                        background:
                            'radial-gradient(600px circle at 15% 20%, rgba(109,94,252,0.25), transparent 60%), radial-gradient(500px circle at 85% 80%, rgba(139,125,255,0.18), transparent 55%)'
                    }}
                />

                <Logo className="relative z-10" />

                <div className="relative z-10 max-w-md">
                    <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs font-medium text-brand-light">
                        <Sparkles size={12} />
                        AI Sales Platform
                    </span>
                    <h2 className="text-3xl font-bold leading-tight tracking-tight text-text">
                        Ürününüzü, uykuya hiç dalmayan bir satış ekibiyle tanıtın.
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-text-muted">
                        Ziyaretçilerinizle gerçek zamanlı konuşan, ekranınızı gezdiren ve her görüşmeyi
                        analiz eden bir AI temsilci kurun.
                    </p>

                    <ul className="mt-8 flex flex-col gap-3">
                        {FEATURES.map(({ icon: Icon, text }) => (
                            <li key={text} className="flex items-center gap-3 text-sm text-text">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised border border-border text-brand-light">
                                    <Icon size={15} />
                                </span>
                                {text}
                            </li>
                        ))}
                    </ul>
                </div>

                <p className="relative z-10 text-xs text-text-muted">© {new Date().getFullYear()} SalesAI. Tüm hakları saklıdır.</p>
            </div>

            <div className="flex items-center justify-center bg-bg p-6 sm:p-12">
                <div className="w-full max-w-sm">{children}</div>
            </div>
        </div>
    );
}
