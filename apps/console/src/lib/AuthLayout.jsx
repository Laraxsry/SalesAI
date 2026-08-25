import { Logo } from '@repo/ui';
import { Sparkles, Mic, LineChart, ScreenShare, ArrowUpRight, ShieldCheck } from 'lucide-react';

const FEATURES = [
    { icon: Mic, text: 'Sesli + görüntülü AI satış temsilcisi' },
    { icon: ScreenShare, text: 'Canlı ekran turu ve co-browsing' },
    { icon: LineChart, text: 'Konuşma analitiği ve lead skorlama' }
];

/** Two-column shell shared by the login and register screens. */
export function AuthLayout({ children }) {
    return (
        <div className="grid min-h-screen bg-[#f7f9f6] lg:grid-cols-[1.08fr_0.92fr]">
            <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0b1f1b] p-10 text-white lg:flex xl:p-14">
                <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                        background:
                            'radial-gradient(520px circle at 15% 10%, rgba(20,184,166,0.22), transparent 64%), radial-gradient(500px circle at 90% 85%, rgba(215,249,91,0.12), transparent 60%)'
                    }}
                />

                <div className="relative z-10 flex items-center gap-3">
                    <Logo className="[&_span]:text-white [&_span_span]:text-[#d7f95b]" />
                </div>

                <div className="relative z-10 max-w-xl">
                    <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-[#d7f95b] backdrop-blur">
                        <Sparkles size={12} />
                        Yapay zeka destekli satış operasyonu
                    </span>
                    <h2 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-white xl:text-5xl">
                        Her görüşmeyi ölçülebilir bir satış fırsatına dönüştürün.
                    </h2>
                    <p className="mt-5 max-w-lg text-[15px] leading-7 text-white/55">
                        Müşterinizle konuşan, ürünü canlı gösteren ve satış sinyallerini ekibiniz için anlaşılır hale getiren tek çalışma alanı.
                    </p>

                    <ul className="mt-9 grid gap-3 sm:grid-cols-3">
                        {FEATURES.map(({ icon: Icon, text }) => (
                            <li key={text} className="rounded-2xl border border-white/8 bg-white/[0.045] p-4 text-xs leading-5 text-white/70 backdrop-blur">
                                <span className="mb-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#d7f95b]/10 text-[#d7f95b]">
                                    <Icon size={15} />
                                </span>
                                {text}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="relative z-10 flex items-center justify-between text-xs text-white/35">
                    <span>© {new Date().getFullYear()} SalesAI</span>
                    <span className="flex items-center gap-1.5"><ShieldCheck size={13} /> Kurumsal güvenlik</span>
                </div>
            </div>

            <div className="relative flex items-center justify-center overflow-hidden p-6 sm:p-12">
                <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/8 blur-3xl" />
                <div className="relative w-full max-w-[420px] rounded-[28px] border border-white bg-white/80 p-7 shadow-[0_30px_90px_-45px_rgba(13,45,38,0.38)] backdrop-blur sm:p-9">
                    <span className="absolute right-7 top-7 hidden h-9 w-9 items-center justify-center rounded-xl bg-surface-raised text-brand sm:flex"><ArrowUpRight size={16} /></span>
                    {children}
                </div>
            </div>
        </div>
    );
}
