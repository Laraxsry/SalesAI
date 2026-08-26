import { Link } from 'react-router-dom';
import { Logo } from '@repo/ui';
import {
    ArrowRight,
    BarChart3,
    Bot,
    Check,
    ChevronRight,
    Headphones,
    LockKeyhole,
    Mic2,
    MonitorUp,
    Moon,
    ShieldCheck,
    Sparkles,
    Sun,
    Target,
    Zap
} from 'lucide-react';
import { useTheme } from '../lib/ThemeProvider.jsx';
import { useAuthStore } from '../store/auth.js';

const CAPABILITIES = [
    {
        icon: Mic2,
        eyebrow: 'Doğal ses',
        title: 'Konuşmayı sürdüren temsilci',
        description: 'Soruları yanıtlar, ihtiyacı netleştirir ve görüşmenin ritmini müşteriye göre ayarlar.'
    },
    {
        icon: MonitorUp,
        eyebrow: 'Canlı bağlam',
        title: 'Ekranı anlayan satış zekası',
        description: 'Paylaşılan ekranı görüşmeyle birlikte değerlendirir ve doğru anda doğru yönlendirmeyi yapar.'
    },
    {
        icon: BarChart3,
        eyebrow: 'Tek merkez',
        title: 'Her görüşmeden aksiyon',
        description: 'Lead, görüşme ve temsilci performansını tek çalışma alanında görünür hale getirir.'
    }
];

const STEPS = [
    {
        number: '01',
        title: 'Bilgiyi tanımlayın',
        description: 'Ürünlerinizi, satış hedeflerinizi ve temsilci davranışını çalışma alanınıza ekleyin.'
    },
    {
        number: '02',
        title: 'Görüşmeyi başlatın',
        description: 'Ses ve ekran bağlamıyla çalışan temsilcinizi müşterinizle güvenli biçimde buluşturun.'
    },
    {
        number: '03',
        title: 'Sonucu yönetin',
        description: 'Görüşme özetlerini, lead sinyallerini ve sonraki adımları konsoldan takip edin.'
    }
];

function MeetingPreview() {
    return (
        <div className="landing-product-frame landing-float relative mx-auto w-full max-w-[620px] overflow-hidden rounded-[28px] border border-white/10 bg-[#071713] p-3 shadow-[0_38px_100px_-42px_rgba(4,28,23,0.75)] sm:p-4">
            <div className="overflow-hidden rounded-[21px] border border-white/10 bg-[#0b1f1b]">
                <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-3">
                        <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-[#d7f95b] text-[#071713]">
                            <Bot size={16} strokeWidth={2.4} aria-hidden="true" />
                            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0b1f1b] bg-[#34d399]" />
                        </span>
                        <div>
                            <p className="text-xs font-bold text-white">SalesAI Görüşmesi</p>
                            <p className="text-[10px] text-white/45">Ürün keşfi</p>
                        </div>
                    </div>
                    <span className="flex items-center gap-1.5 rounded-full border border-[#d7f95b]/20 bg-[#d7f95b]/10 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#d7f95b]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d7f95b]" /> Canlı
                    </span>
                </div>

                <div className="grid min-h-[330px] grid-cols-1 sm:grid-cols-[1fr_176px]">
                    <div className="relative flex min-h-[280px] flex-col justify-between overflow-hidden border-b border-white/8 p-5 sm:border-b-0 sm:border-r sm:p-6">
                        <div className="landing-preview-grid absolute inset-0 opacity-70" aria-hidden="true" />
                        <div className="relative z-10 flex items-center justify-between">
                            <span className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[10px] font-semibold text-white/55">Ekran bağlamı açık</span>
                            <MonitorUp size={16} className="text-[#d7f95b]" aria-hidden="true" />
                        </div>

                        <div className="relative z-10 mx-auto flex flex-col items-center text-center">
                            <div className="relative mb-5 flex h-24 w-24 items-center justify-center rounded-full border border-[#d7f95b]/20 bg-[#d7f95b]/[0.06]">
                                <div className="landing-orbit absolute inset-2 rounded-full border border-dashed border-[#d7f95b]/25" />
                                <div className="landing-signal flex h-12 items-center gap-1" aria-label="Temsilci konuşuyor">
                                    {[17, 31, 43, 27, 38, 21].map((height, index) => (
                                        <span key={index} style={{ '--signal-height': `${height}px`, '--signal-delay': `${index * 90}ms` }} />
                                    ))}
                                </div>
                            </div>
                            <p className="max-w-[270px] text-[15px] font-semibold leading-relaxed text-white">“İhtiyacınıza en uygun akışı birlikte netleştirelim.”</p>
                            <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#d7f95b]">AI temsilci konuşuyor</p>
                        </div>

                        <div className="relative z-10 flex items-center justify-center gap-2">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-white/70"><Mic2 size={14} /></span>
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-white/70"><MonitorUp size={14} /></span>
                            <span className="rounded-full bg-[#f87171] px-4 py-2 text-[10px] font-extrabold text-[#2b0c0c]">Görüşmeyi bitir</span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 bg-black/10 p-4">
                        <p className="text-[9px] font-extrabold uppercase tracking-[0.17em] text-white/35">Canlı sinyaller</p>
                        <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
                            <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#d7f95b]/10 text-[#d7f95b]"><Target size={14} /></span>
                            <p className="text-[10px] text-white/45">Satın alma niyeti</p>
                            <p className="mt-1 text-xs font-bold text-white">Güçlü sinyal</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
                            <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#5eead4]/10 text-[#5eead4]"><Zap size={14} /></span>
                            <p className="text-[10px] text-white/45">Sonraki adım</p>
                            <p className="mt-1 text-xs font-bold text-white">Demo planla</p>
                        </div>
                        <div className="mt-auto rounded-xl border border-[#d7f95b]/15 bg-[#d7f95b]/[0.06] p-3">
                            <p className="text-[10px] font-semibold leading-relaxed text-white/65">Görüşme özeti ve aksiyonlar otomatik hazırlanıyor.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function Landing() {
    const accessToken = useAuthStore((state) => state.accessToken);
    const { isDark, toggleTheme } = useTheme();
    const primaryHref = accessToken ? '/' : '/register';

    return (
        <div className="min-h-screen overflow-hidden bg-bg text-text">
            <header className="sticky top-0 z-50 border-b border-border/70 bg-surface/80 backdrop-blur-xl">
                <div className="mx-auto flex h-[72px] w-full max-w-[1240px] items-center justify-between px-5 sm:px-8">
                    <Link to="/mainpage" aria-label="SalesAI ana sayfa" className="shrink-0">
                        <Logo />
                    </Link>
                    <nav className="hidden items-center gap-7 md:flex" aria-label="Ana sayfa menüsü">
                        <a href="#urun" className="text-sm font-semibold text-text-muted transition-colors hover:text-text">Ürün</a>
                        <a href="#nasil-calisir" className="text-sm font-semibold text-text-muted transition-colors hover:text-text">Nasıl çalışır?</a>
                        <a href="#guvenlik" className="text-sm font-semibold text-text-muted transition-colors hover:text-text">Güvenlik</a>
                    </nav>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <button
                            type="button"
                            onClick={toggleTheme}
                            aria-label={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
                            title={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-text transition-colors hover:bg-surface-raised"
                        >
                            {isDark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
                        </button>
                        {!accessToken && <Link to="/login" className="hidden px-2 text-sm font-bold text-text sm:block">Giriş yap</Link>}
                        <Link to={primaryHref} className="flex h-10 items-center gap-2 rounded-xl bg-[#0b1f1b] px-4 text-xs font-extrabold text-white shadow-[0_10px_28px_-16px_rgba(7,23,19,0.8)] transition-transform hover:-translate-y-0.5 dark:bg-[#d7f95b] dark:text-[#071713] sm:px-5 sm:text-sm">
                            {accessToken ? 'Konsola dön' : 'Hemen başla'} <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                    </div>
                </div>
            </header>

            <main>
                <section className="landing-hero relative border-b border-border/70">
                    <div className="mx-auto grid min-h-[calc(100vh-72px)] w-full max-w-[1240px] items-center gap-14 px-5 py-16 sm:px-8 lg:grid-cols-[0.88fr_1.12fr] lg:gap-12 lg:py-20">
                        <div className="landing-reveal relative z-10 max-w-[620px]">
                            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/8 px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-brand sm:text-[11px]">
                                <Sparkles size={14} aria-hidden="true" /> Ses, ekran ve satış zekası
                            </div>
                            <h1 className="text-[44px] font-bold leading-[0.98] tracking-[-0.05em] text-text sm:text-[62px] lg:text-[72px]">
                                Satış görüşmelerinin <span className="text-brand">yeni çalışma biçimi.</span>
                            </h1>
                            <p className="mt-7 max-w-[560px] text-base font-medium leading-7 text-text-muted sm:text-lg sm:leading-8">
                                Müşterinizle konuşan, paylaşılan ekranı anlayan ve her görüşmeyi ölçülebilir bir sonraki adıma taşıyan AI satış temsilcisi.
                            </p>
                            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                                <Link to={primaryHref} className="group flex h-13 items-center justify-center gap-2 rounded-[14px] bg-[#0b1f1b] px-6 text-sm font-extrabold text-white shadow-[0_18px_36px_-20px_rgba(7,23,19,0.9)] transition-transform hover:-translate-y-0.5 dark:bg-[#d7f95b] dark:text-[#071713]">
                                    {accessToken ? 'Çalışma alanına dön' : 'Çalışma alanı oluştur'}
                                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                                </Link>
                                <a href="#urun" className="flex h-13 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-6 text-sm font-extrabold text-text transition-colors hover:bg-surface-raised">
                                    Ürünü keşfet <ChevronRight size={16} aria-hidden="true" />
                                </a>
                            </div>
                            <div className="mt-9 flex flex-wrap gap-x-5 gap-y-3 text-xs font-semibold text-text-muted">
                                {['Canlı sesli görüşme', 'Ekran bağlamı', 'Otomatik görüşme özeti'].map((item) => (
                                    <span key={item} className="flex items-center gap-2"><Check size={14} className="text-brand" strokeWidth={3} aria-hidden="true" />{item}</span>
                                ))}
                            </div>
                        </div>

                        <div className="landing-reveal landing-reveal-delay relative z-10 lg:translate-x-5">
                            <div className="landing-halo absolute inset-[12%] rounded-full bg-brand/15 blur-[90px]" aria-hidden="true" />
                            <MeetingPreview />
                        </div>
                    </div>
                </section>

                <section className="border-b border-border/70 bg-surface/55">
                    <div className="mx-auto grid w-full max-w-[1240px] grid-cols-2 gap-px px-5 py-0 sm:px-8 lg:grid-cols-4">
                        {[
                            ['01', 'Konuşmayı dinler'],
                            ['02', 'Ekranı yorumlar'],
                            ['03', 'Niyeti yakalar'],
                            ['04', 'Aksiyonu oluşturur']
                        ].map(([number, label]) => (
                            <div key={number} className="flex min-h-24 items-center gap-4 border-border px-3 py-5 even:border-l lg:border-l lg:first:border-l-0 sm:px-5">
                                <span className="font-display text-xs font-bold text-brand">{number}</span>
                                <span className="text-xs font-bold text-text sm:text-sm">{label}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section id="urun" className="scroll-mt-24 px-5 py-24 sm:px-8 lg:py-32">
                    <div className="mx-auto w-full max-w-[1240px]">
                        <div className="max-w-[720px]">
                            <p className="mb-4 text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand">Tek görüşme, tam bağlam</p>
                            <h2 className="text-3xl font-bold leading-tight tracking-[-0.035em] text-text sm:text-5xl">Satış ekibinizin ihtiyaç duyduğu yetenekler, tek bir deneyimde.</h2>
                        </div>
                        <div className="mt-14 grid gap-4 lg:grid-cols-3">
                            {CAPABILITIES.map(({ icon: Icon, eyebrow, title, description }, index) => (
                                <article key={title} className="card-lift group relative min-h-[330px] overflow-hidden rounded-[24px] border border-border bg-surface p-7 sm:p-8">
                                    <span className="absolute right-7 top-7 font-display text-xs font-bold text-text-muted/45">0{index + 1}</span>
                                    <span className="flex h-12 w-12 items-center justify-center rounded-[15px] bg-[#0b1f1b] text-[#d7f95b] shadow-lg shadow-[#071713]/10">
                                        <Icon size={21} aria-hidden="true" />
                                    </span>
                                    <div className="mt-20">
                                        <p className="text-[10px] font-extrabold uppercase tracking-[0.17em] text-brand">{eyebrow}</p>
                                        <h3 className="mt-3 text-2xl font-bold tracking-[-0.025em] text-text">{title}</h3>
                                        <p className="mt-4 text-sm font-medium leading-6 text-text-muted">{description}</p>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section id="nasil-calisir" className="scroll-mt-20 bg-[#0b1f1b] px-5 py-24 text-white sm:px-8 lg:py-32">
                    <div className="mx-auto grid w-full max-w-[1240px] gap-16 lg:grid-cols-[0.72fr_1.28fr] lg:gap-24">
                        <div>
                            <p className="mb-4 text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#d7f95b]">Nasıl çalışır?</p>
                            <h2 className="text-3xl font-bold leading-tight tracking-[-0.035em] sm:text-5xl">Dakikalar içinde görüşmeye hazır.</h2>
                            <p className="mt-6 max-w-md text-sm font-medium leading-7 text-white/55 sm:text-base">Teknik bir entegrasyon projesine dönüşmeden, satış bilginizi çalışan bir temsilciye dönüştürün.</p>
                        </div>
                        <div className="border-t border-white/12">
                            {STEPS.map(({ number, title, description }) => (
                                <article key={number} className="grid gap-4 border-b border-white/12 py-7 sm:grid-cols-[56px_0.7fr_1fr] sm:items-start sm:gap-6 sm:py-8">
                                    <span className="font-display text-xs font-bold text-[#d7f95b]">{number}</span>
                                    <h3 className="text-xl font-bold tracking-[-0.02em]">{title}</h3>
                                    <p className="text-sm font-medium leading-6 text-white/55">{description}</p>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section id="guvenlik" className="scroll-mt-20 px-5 py-24 sm:px-8 lg:py-32">
                    <div className="mx-auto grid w-full max-w-[1240px] overflow-hidden rounded-[28px] border border-border bg-surface lg:grid-cols-[1fr_0.88fr]">
                        <div className="p-8 sm:p-12 lg:p-16">
                            <span className="flex h-12 w-12 items-center justify-center rounded-[15px] bg-brand/10 text-brand"><ShieldCheck size={22} aria-hidden="true" /></span>
                            <p className="mb-4 mt-10 text-[11px] font-extrabold uppercase tracking-[0.18em] text-brand">Kontrol sizde</p>
                            <h2 className="max-w-[560px] text-3xl font-bold leading-tight tracking-[-0.035em] text-text sm:text-5xl">Güven veren görüşmeler için tasarlandı.</h2>
                            <p className="mt-6 max-w-[590px] text-sm font-medium leading-7 text-text-muted sm:text-base">Temsilci bilgisinden ekip erişimine kadar kritik çalışma alanı ayarlarını tek merkezden yönetin. Görüşme geçmişi ve aksiyonlar yalnızca yetkili ekibinizle kalır.</p>
                        </div>
                        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-1">
                            {[
                                [LockKeyhole, 'Yetkili erişim', 'Ekip üyeleri ve çalışma alanı rolleri kontrollü biçimde yönetilir.'],
                                [Headphones, 'İzlenebilir görüşme', 'Görüşme sonuçları ve takip adımları düzenli bir kayıt altında tutulur.']
                            ].map(([Icon, title, description]) => (
                                <div key={title} className="flex flex-col justify-center bg-surface-raised p-8 sm:p-10">
                                    <Icon size={21} className="text-brand" aria-hidden="true" />
                                    <h3 className="mt-6 text-xl font-bold text-text">{title}</h3>
                                    <p className="mt-3 text-sm font-medium leading-6 text-text-muted">{description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="px-5 pb-24 sm:px-8 lg:pb-32">
                    <div className="mx-auto flex w-full max-w-[1240px] flex-col items-start justify-between gap-8 rounded-[28px] bg-[#d7f95b] p-8 text-[#071713] sm:p-12 lg:flex-row lg:items-center lg:p-14">
                        <div>
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] opacity-60">Satışın yeni ritmi</p>
                            <h2 className="mt-3 max-w-[690px] text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl">Bir sonraki görüşmenizi SalesAI ile başlatın.</h2>
                        </div>
                        <Link to={primaryHref} className="group flex h-13 shrink-0 items-center gap-2 rounded-[14px] bg-[#071713] px-6 text-sm font-extrabold text-white transition-transform hover:-translate-y-0.5">
                            {accessToken ? 'Konsola dön' : 'Hemen başla'} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </Link>
                    </div>
                </section>
            </main>

            <footer className="border-t border-border bg-surface px-5 py-8 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <Logo />
                    <p className="text-xs font-semibold text-text-muted">AI destekli satış görüşmeleri için tek çalışma alanı.</p>
                    <div className="flex items-center gap-5 text-xs font-bold text-text-muted">
                        <a href="#urun" className="hover:text-text">Ürün</a>
                        <Link to="/login" className="hover:text-text">Giriş</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
