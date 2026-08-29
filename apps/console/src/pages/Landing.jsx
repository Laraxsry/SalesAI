import { Link } from 'react-router-dom';
import { Logo } from '@repo/ui';
import {
    ArrowRight,
    ArrowUpRight,
    AudioLines,
    Bot,
    Check,
    ChevronDown,
    Gauge,
    LockKeyhole,
    Mic2,
    MonitorUp,
    Moon,
    MousePointer2,
    ScanLine,
    ShieldCheck,
    Sparkles,
    Sun,
    Target,
    WandSparkles,
    Zap
} from 'lucide-react';
import { useTheme } from '../lib/ThemeProvider.jsx';
import { useAuthStore } from '../store/auth.js';

const FLOW = [
    {
        number: '01',
        title: 'Bilgiyi öğretin',
        description: 'Ürününüzü, satış hedeflerinizi ve marka tonunuzu tek çalışma alanında tanımlayın.'
    },
    {
        number: '02',
        title: 'Görüşmeyi açın',
        description: 'AI temsilciniz ses ve ekran bağlamıyla müşterinizin karşısına saniyeler içinde çıksın.'
    },
    {
        number: '03',
        title: 'Sinyali yakalayın',
        description: 'Her görüşme lead sinyaline, özete ve net bir sonraki adıma otomatik dönüşsün.'
    }
];

const WAVE_HEIGHTS = [18, 36, 24, 54, 30, 68, 42, 58, 26, 46, 20, 34, 56, 28, 44, 18];

function Waveform({ compact = false }) {
    return (
        <div className={`wow-wave flex items-center justify-center gap-1 ${compact ? 'h-10' : 'h-20'}`} aria-label="Canlı ses dalgası">
            {WAVE_HEIGHTS.map((height, index) => (
                <span
                    key={`${height}-${index}`}
                    style={{ '--wave-height': `${compact ? Math.max(8, height * 0.58) : height}px`, '--wave-delay': `${index * 55}ms` }}
                />
            ))}
        </div>
    );
}

function HeroSignal() {
    return (
        <div className="wow-float-card absolute bottom-16 right-8 hidden w-[330px] overflow-hidden rounded-[24px] border border-white/15 bg-[#091815]/72 p-5 text-white shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-2xl xl:block">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d7f95b] text-[#071713]"><AudioLines size={19} /></span>
                    <div>
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.17em] text-white/40">Canlı görüşme</p>
                        <p className="mt-0.5 text-sm font-bold">AI temsilci konuşuyor</p>
                    </div>
                </div>
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#d7f95b] shadow-[0_0_18px_#d7f95b]" />
            </div>
            <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-2">
                <Waveform compact />
            </div>
            <div className="mt-4 flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-2 text-white/50"><Target size={13} className="text-[#d7f95b]" /> Satın alma niyeti</span>
                <span className="font-extrabold text-[#d7f95b]">GÜÇLÜ</span>
            </div>
        </div>
    );
}

function ProductStage() {
    return (
        <div className="wow-product-shell mx-auto w-full max-w-[1180px] rounded-[26px] border border-white/12 bg-[#091915] p-2 shadow-[0_60px_140px_-55px_rgba(0,0,0,0.95)] sm:p-3">
            <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#0b1f1b]">
                <div className="flex h-14 items-center justify-between border-b border-white/8 px-4 sm:px-6">
                    <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d7f95b] text-[#071713]"><Bot size={16} strokeWidth={2.5} /></span>
                        <div>
                            <p className="text-xs font-extrabold text-white">SalesAI Live</p>
                            <p className="text-[9px] font-semibold text-white/35">Ürün keşfi görüşmesi</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-bold text-white/45 sm:block">12:48</span>
                        <span className="flex items-center gap-2 rounded-full bg-[#d7f95b]/10 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#d7f95b]"><span className="h-1.5 w-1.5 rounded-full bg-[#d7f95b]" /> Canlı</span>
                    </div>
                </div>

                <div className="grid min-h-[560px] lg:grid-cols-[1fr_270px]">
                    <div className="relative overflow-hidden border-b border-white/8 bg-[#071713] p-4 lg:border-b-0 lg:border-r sm:p-6">
                        <div className="wow-stage-grid absolute inset-0" aria-hidden="true" />
                        <div className="relative z-10 flex items-center justify-between">
                            <span className="flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 text-[10px] font-bold text-white/50"><MonitorUp size={13} className="text-[#d7f95b]" /> Müşteri ekranı analiz ediliyor</span>
                            <ScanLine size={18} className="text-[#d7f95b]" />
                        </div>

                        <div className="relative z-10 mx-auto mt-10 max-w-[720px] overflow-hidden rounded-[18px] border border-white/12 bg-[#f1f5ef] text-[#10221d] shadow-[0_36px_80px_-30px_rgba(0,0,0,0.7)] sm:mt-12">
                            <div className="flex h-10 items-center justify-between border-b border-[#dbe4dc] bg-white px-3 sm:px-4">
                                <div className="flex gap-1.5"><span className="h-2 w-2 rounded-full bg-[#ff7a70]" /><span className="h-2 w-2 rounded-full bg-[#f5cb58]" /><span className="h-2 w-2 rounded-full bg-[#52c884]" /></div>
                                <div className="h-2 w-24 rounded-full bg-[#e1e8e2] sm:w-40" />
                                <div className="h-5 w-5 rounded-md bg-[#d7f95b]" />
                            </div>
                            <div className="grid min-h-[350px] grid-cols-[52px_1fr] sm:grid-cols-[140px_1fr]">
                                <div className="border-r border-[#dbe4dc] bg-[#0c211b] p-3 sm:p-4">
                                    <div className="mb-6 hidden text-[11px] font-extrabold text-white sm:block">NORTHSTAR</div>
                                    {[0, 1, 2, 3, 4].map((item) => <div key={item} className={`mb-3 h-7 rounded-lg ${item === 1 ? 'bg-[#d7f95b]' : 'bg-white/[0.07]'}`} />)}
                                </div>
                                <div className="p-4 sm:p-6">
                                    <div className="flex items-start justify-between gap-3">
                                        <div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#819088]">Performans</p><p className="mt-1 text-base font-extrabold sm:text-xl">Satış görünümü</p></div>
                                        <span className="rounded-lg bg-[#d7f95b] px-3 py-2 text-[9px] font-extrabold">Rapor oluştur</span>
                                    </div>
                                    <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
                                        {[['Görüşme', '48'], ['Nitelikli', '19'], ['Takip', '12']].map(([label, value]) => (
                                            <div key={label} className="rounded-xl border border-[#dbe4dc] bg-white p-3"><p className="text-[8px] font-bold text-[#819088]">{label}</p><p className="mt-2 text-lg font-extrabold sm:text-2xl">{value}</p></div>
                                        ))}
                                    </div>
                                    <div className="mt-3 rounded-xl border border-[#dbe4dc] bg-white p-4">
                                        <div className="flex items-center justify-between"><p className="text-[10px] font-extrabold">Dönüşüm akışı</p><span className="text-[8px] font-bold text-[#819088]">Son 30 gün</span></div>
                                        <div className="mt-5 flex h-28 items-end gap-2">
                                            {[30, 52, 44, 70, 58, 88, 68, 96, 78, 100].map((height, index) => <span key={index} style={{ height: `${height}%` }} className={`flex-1 rounded-t-sm ${index > 6 ? 'bg-[#0f766e]' : 'bg-[#d7f95b]'}`} />)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="wow-listening-orb absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#d7f95b]/25 bg-[#091915]/90 py-2 pl-2 pr-5 shadow-2xl backdrop-blur-xl sm:bottom-10">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d7f95b] text-[#071713]"><Mic2 size={17} /></span>
                            <div><p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#d7f95b]">Dinliyor</p><p className="text-xs font-bold text-white">“Bu raporu ekibimle paylaşabilir miyim?”</p></div>
                        </div>
                    </div>

                    <aside className="flex flex-col bg-[#0d241e] p-5 sm:p-6">
                        <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-white/35">Canlı zeka</p>
                        <div className="mt-5 space-y-3">
                            {[
                                [Target, 'Niyet', 'Karar aşaması', '#d7f95b'],
                                [Gauge, 'İlgi', 'Raporlama', '#5eead4'],
                                [Zap, 'Sonraki adım', 'Demo planla', '#f6c85f']
                            ].map(([Icon, label, value, color]) => (
                                <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                                    <Icon size={16} style={{ color }} />
                                    <p className="mt-5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/35">{label}</p>
                                    <p className="mt-1 text-sm font-extrabold text-white">{value}</p>
                                </div>
                            ))}
                        </div>
                        <div className="mt-auto pt-6">
                            <div className="rounded-2xl border border-[#d7f95b]/15 bg-[#d7f95b]/[0.07] p-4">
                                <div className="flex items-center gap-2 text-[#d7f95b]"><WandSparkles size={14} /><span className="text-[9px] font-extrabold uppercase tracking-[0.15em]">AI önerisi</span></div>
                                <p className="mt-3 text-xs font-semibold leading-5 text-white/65">Ekip paylaşımı ve yetkilendirme akışını şimdi göster.</p>
                            </div>
                        </div>
                    </aside>
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
            <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#071713]/72 text-white backdrop-blur-2xl">
                <div className="mx-auto flex h-[76px] w-full max-w-[1400px] items-center justify-between px-5 sm:px-8 lg:px-10">
                    <Link to="/mainpage" aria-label="SalesAI ana sayfa" className="shrink-0">
                        <Logo className="[&_span]:text-white [&_span_span]:text-[#d7f95b]" />
                    </Link>
                    <nav className="hidden items-center gap-8 lg:flex" aria-label="Ana sayfa menüsü">
                        <a href="#urun" className="text-xs font-bold text-white/55 transition-colors hover:text-white">Ürün</a>
                        <a href="#deneyim" className="text-xs font-bold text-white/55 transition-colors hover:text-white">Deneyim</a>
                        <a href="#nasil-calisir" className="text-xs font-bold text-white/55 transition-colors hover:text-white">Nasıl çalışır?</a>
                        <a href="#guvenlik" className="text-xs font-bold text-white/55 transition-colors hover:text-white">Güvenlik</a>
                    </nav>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <button
                            type="button"
                            onClick={toggleTheme}
                            aria-label={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
                            title={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white transition-colors hover:bg-white/10"
                        >
                            {isDark ? <Sun size={16} /> : <Moon size={16} />}
                        </button>
                        {!accessToken && <Link to="/login" className="hidden px-2 text-xs font-bold text-white/65 transition-colors hover:text-white sm:block">Giriş yap</Link>}
                        <Link to={primaryHref} className="group flex h-10 items-center gap-2 rounded-full bg-[#d7f95b] px-4 text-xs font-extrabold text-[#071713] transition-transform hover:-translate-y-0.5 sm:px-5">
                            {accessToken ? 'Konsola dön' : 'Hemen başla'} <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </Link>
                    </div>
                </div>
            </header>

            <main>
                <section className="wow-hero relative flex min-h-[820px] items-end overflow-hidden bg-[#071713] text-white lg:h-[100svh] lg:min-h-[720px]">
                    <img src="/images/salesai-hero.webp" alt="SalesAI ile canlı satış görüşmesi yapan profesyonel" className="wow-hero-image absolute inset-0 h-full w-full object-cover object-[66%_center]" />
                    <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,13,10,0.98)_0%,rgba(3,13,10,0.88)_32%,rgba(3,13,10,0.18)_70%,rgba(3,13,10,0.28)_100%)]" />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,13,10,0.4)_0%,transparent_30%,rgba(3,13,10,0.12)_60%,rgba(3,13,10,0.78)_100%)]" />
                    <div className="wow-hero-noise absolute inset-0 opacity-40" aria-hidden="true" />

                    <div className="relative z-10 mx-auto w-full max-w-[1400px] px-5 pb-20 pt-36 sm:px-8 sm:pb-24 lg:px-10 lg:pb-24">
                        <div className="wow-reveal max-w-[820px]">
                            <div className="mb-7 inline-flex items-center gap-3 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#d7f95b] backdrop-blur-xl">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-[#d7f95b] shadow-[0_0_15px_#d7f95b]" /> AI Sales Operating System
                            </div>
                            <h1 className="font-display text-[clamp(3.65rem,8.4vw,8rem)] font-bold leading-[0.82] tracking-[-0.065em]">
                                <span className="block">Konuşur.</span>
                                <span className="block">Görür.</span>
                                <span className="block text-[#d7f95b]">Satışı ilerletir.</span>
                            </h1>
                            <p className="mt-8 max-w-[610px] text-base font-medium leading-7 text-white/62 sm:text-lg sm:leading-8">
                                Müşterinizle doğal biçimde konuşan, paylaşılan ekranı anlayan ve her görüşmeyi net bir sonraki adıma taşıyan AI satış temsilcisi.
                            </p>
                            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                                <Link to={primaryHref} className="group flex h-13 items-center justify-center gap-3 rounded-full bg-[#d7f95b] px-7 text-sm font-extrabold text-[#071713] shadow-[0_18px_50px_-20px_rgba(215,249,91,0.75)] transition-transform hover:-translate-y-1">
                                    {accessToken ? 'Çalışma alanına dön' : 'AI temsilcini oluştur'} <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                                </Link>
                                <a href="#deneyim" className="flex h-13 items-center justify-center gap-3 rounded-full border border-white/16 bg-white/[0.06] px-7 text-sm font-extrabold text-white backdrop-blur-xl transition-colors hover:bg-white/12">
                                    Deneyimi gör <ChevronDown size={16} />
                                </a>
                            </div>
                            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-[11px] font-bold text-white/45">
                                {['Canlı doğal ses', 'Ekran farkındalığı', 'Anlık satış sinyali'].map((item) => <span key={item} className="flex items-center gap-2"><Check size={13} className="text-[#d7f95b]" strokeWidth={3} />{item}</span>)}
                            </div>
                        </div>
                    </div>

                    <HeroSignal />
                    <div className="absolute bottom-6 right-8 z-20 hidden items-center gap-3 text-[9px] font-extrabold uppercase tracking-[0.2em] text-white/35 lg:flex"><span className="h-px w-14 bg-white/25" /> İnsan gibi. Veriye dayalı.</div>
                </section>

                <section className="overflow-hidden border-y border-[#d7f95b]/30 bg-[#d7f95b] py-4 text-[#071713]">
                    <div className="wow-marquee flex w-max items-center gap-8 whitespace-nowrap font-display text-sm font-bold uppercase tracking-[0.17em]">
                        {[0, 1].map((group) => (
                            <div key={group} className="flex items-center gap-8" aria-hidden={group === 1}>
                                {['Dinler', 'Anlar', 'Gösterir', 'İkna eder', 'Özetler', 'Takip eder'].map((item) => <span key={`${group}-${item}`} className="flex items-center gap-8">{item}<Sparkles size={13} /></span>)}
                            </div>
                        ))}
                    </div>
                </section>

                <section id="urun" className="scroll-mt-20 px-5 py-24 sm:px-8 lg:py-36">
                    <div className="mx-auto w-full max-w-[1280px]">
                        <div className="grid items-end gap-10 lg:grid-cols-[1fr_0.48fr]">
                            <h2 className="max-w-[880px] text-[clamp(2.65rem,6vw,5.6rem)] font-bold leading-[0.94] tracking-[-0.055em] text-text">Bir chatbot değil. <span className="text-brand">Görüşmenin içinde çalışan</span> satış zekası.</h2>
                            <p className="max-w-md border-l border-brand/30 pl-6 text-sm font-medium leading-7 text-text-muted sm:text-base">SalesAI yalnızca cevap vermez. Müşterinin ne söylediğini, ne gördüğünü ve hangi noktada karar verdiğini aynı anda okur.</p>
                        </div>

                        <div className="mt-16 grid gap-4 lg:grid-cols-12 lg:auto-rows-[280px]">
                            <article className="wow-bento-card relative overflow-hidden rounded-[28px] bg-[#d7f95b] p-7 text-[#071713] sm:p-9 lg:col-span-7 lg:row-span-2">
                                <div className="relative z-10 flex h-full flex-col">
                                    <div className="flex items-start justify-between"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#071713] text-[#d7f95b]"><Mic2 size={21} /></span><span className="font-display text-xs font-bold opacity-45">01 / SES</span></div>
                                    <div className="my-auto py-12"><Waveform /><p className="mt-6 max-w-lg text-sm font-semibold leading-6 opacity-65">Kesintisiz doğal konuşma, anlık niyet algısı ve müşterinin ritmine uyum sağlayan canlı bir temsilci.</p></div>
                                    <h3 className="max-w-xl text-3xl font-bold leading-tight tracking-[-0.035em] sm:text-5xl">Sadece duymaz.<br />Ne demek istediğini anlar.</h3>
                                </div>
                                <div className="wow-ring absolute -bottom-44 -right-36 h-[430px] w-[430px] rounded-full border border-[#071713]/15" />
                            </article>

                            <article className="wow-bento-card relative overflow-hidden rounded-[28px] bg-[#0b1f1b] p-7 text-white sm:p-9 lg:col-span-5">
                                <div className="flex items-start justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/8 text-[#5eead4]"><MonitorUp size={20} /></span><span className="font-display text-xs font-bold text-white/30">02 / EKRAN</span></div>
                                <div className="mt-10 flex items-end justify-between gap-5"><div><h3 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Ekranı sizinle birlikte görür.</h3><p className="mt-3 max-w-sm text-sm font-medium leading-6 text-white/50">Paylaşılan ürünü, tabloyu veya formu konuşmanın bağlamıyla birlikte yorumlar.</p></div><ScanLine size={40} className="shrink-0 text-[#d7f95b]" strokeWidth={1.25} /></div>
                            </article>

                            <article className="wow-bento-card relative overflow-hidden rounded-[28px] border border-border bg-surface p-7 sm:p-9 lg:col-span-5">
                                <div className="flex items-start justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Target size={20} /></span><span className="font-display text-xs font-bold text-text-muted/40">03 / NİYET</span></div>
                                <div className="mt-8 grid grid-cols-[1fr_auto] items-end gap-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-brand">Canlı sinyal</p><h3 className="mt-2 text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Doğru anda doğru hamle.</h3></div><div className="flex h-20 w-20 items-center justify-center rounded-full border-[7px] border-brand/15 border-t-brand font-display text-xl font-bold text-brand">AI</div></div>
                            </article>
                        </div>
                    </div>
                </section>

                <section id="deneyim" className="wow-stage-section relative scroll-mt-16 overflow-hidden bg-[#06110e] px-5 py-24 text-white sm:px-8 lg:py-36">
                    <div className="wow-stage-glow absolute left-1/2 top-1/3 h-[680px] w-[900px] -translate-x-1/2 rounded-full bg-[#0f766e]/25 blur-[130px]" aria-hidden="true" />
                    <div className="relative z-10 mx-auto w-full max-w-[1280px]">
                        <div className="mb-14 flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
                            <div><p className="mb-4 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#d7f95b]">Görüşmenin merkezi</p><h2 className="max-w-[780px] text-4xl font-bold leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl">Konuşma, ekran ve satış sinyali. <span className="text-white/38">Aynı anda.</span></h2></div>
                            <p className="max-w-sm text-sm font-medium leading-7 text-white/48">Müşterinin gördüğü ekran ile söylediği cümle aynı bağlamda buluşur. Temsilci tahmin etmez; görüşmeyi okur.</p>
                        </div>
                        <ProductStage />
                    </div>
                </section>

                <section id="nasil-calisir" className="scroll-mt-20 px-5 py-24 sm:px-8 lg:py-36">
                    <div className="mx-auto grid w-full max-w-[1280px] gap-16 lg:grid-cols-[0.65fr_1.35fr] lg:gap-24">
                        <div className="lg:sticky lg:top-32 lg:self-start">
                            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Zap size={21} /></span>
                            <p className="mb-4 mt-10 text-[10px] font-extrabold uppercase tracking-[0.2em] text-brand">Kur ve çalıştır</p>
                            <h2 className="text-4xl font-bold leading-tight tracking-[-0.04em] text-text sm:text-5xl">Dakikalar içinde satışa hazır.</h2>
                            <p className="mt-5 max-w-md text-sm font-medium leading-7 text-text-muted">Uzun entegrasyon projeleri yok. Bilginizi verin, temsilcinizi tanımlayın, görüşmeyi açın.</p>
                        </div>
                        <div className="border-t border-border">
                            {FLOW.map(({ number, title, description }) => (
                                <article key={number} className="group grid gap-5 border-b border-border py-9 sm:grid-cols-[70px_0.75fr_1fr] sm:items-start sm:gap-6 sm:py-11">
                                    <span className="font-display text-sm font-bold text-brand">{number}</span>
                                    <h3 className="text-2xl font-bold tracking-[-0.025em] text-text">{title}</h3>
                                    <div className="flex items-start justify-between gap-5"><p className="max-w-md text-sm font-medium leading-6 text-text-muted">{description}</p><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition-all group-hover:border-brand group-hover:bg-brand group-hover:text-white"><ArrowRight size={15} /></span></div>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section id="guvenlik" className="scroll-mt-20 px-5 pb-24 sm:px-8 lg:pb-36">
                    <div className="mx-auto grid w-full max-w-[1280px] overflow-hidden rounded-[30px] bg-[#d7f95b] text-[#071713] lg:grid-cols-[1.15fr_0.85fr]">
                        <div className="p-8 sm:p-12 lg:p-16">
                            <ShieldCheck size={30} strokeWidth={1.7} />
                            <p className="mb-4 mt-16 text-[10px] font-extrabold uppercase tracking-[0.2em] opacity-50">Güvenlik sonradan eklenmedi</p>
                            <h2 className="max-w-[700px] text-4xl font-bold leading-[0.98] tracking-[-0.045em] sm:text-6xl">Görüşmenin kontrolü hep sizde.</h2>
                            <p className="mt-6 max-w-xl text-sm font-semibold leading-7 opacity-60 sm:text-base">Ekip erişimi, temsilci bilgisi ve görüşme geçmişi tek çalışma alanında; yalnızca yetkilendirdiğiniz kişilerle.</p>
                        </div>
                        <div className="grid gap-px bg-[#071713]/15 sm:grid-cols-2 lg:grid-cols-1">
                            {[
                                [LockKeyhole, 'Yetkili erişim', 'Rolleri ve ekip üyelerini merkezden yönetin.'],
                                [MousePointer2, 'Siz durdurun', 'Ekran paylaşımı ve görüşme kontrolü kullanıcıda kalır.']
                            ].map(([Icon, title, description]) => (
                                <div key={title} className="flex flex-col justify-center bg-[#cfee53] p-8 sm:p-10"><Icon size={22} /><h3 className="mt-8 text-2xl font-bold">{title}</h3><p className="mt-3 text-sm font-semibold leading-6 opacity-55">{description}</p></div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="relative overflow-hidden bg-[#071713] px-5 py-24 text-white sm:px-8 lg:py-32">
                    <div className="absolute inset-0 opacity-20"><img src="/images/salesai-hero.webp" alt="" className="h-full w-full object-cover object-[70%_45%] grayscale" /></div>
                    <div className="absolute inset-0 bg-[#071713]/80" />
                    <div className="relative z-10 mx-auto flex w-full max-w-[1280px] flex-col items-start justify-between gap-12 lg:flex-row lg:items-end">
                        <div><p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#d7f95b]">Bir sonraki görüşme</p><h2 className="mt-5 max-w-[850px] text-5xl font-bold leading-[0.9] tracking-[-0.055em] sm:text-7xl lg:text-8xl">Satış ekibinize bir koltuk daha ekleyin.</h2></div>
                        <Link to={primaryHref} className="group flex h-14 shrink-0 items-center gap-3 rounded-full bg-[#d7f95b] px-7 text-sm font-extrabold text-[#071713] transition-transform hover:-translate-y-1">{accessToken ? 'Konsola dön' : 'Hemen başla'}<ArrowUpRight size={17} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></Link>
                    </div>
                </section>
            </main>

            <footer className="border-t border-white/8 bg-[#071713] px-5 py-9 text-white sm:px-8">
                <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                    <Logo className="[&_span]:text-white [&_span_span]:text-[#d7f95b]" />
                    <p className="text-xs font-semibold text-white/35">İnsan gibi konuşan, satış gibi düşünen AI.</p>
                    <div className="flex items-center gap-6 text-xs font-bold text-white/45"><a href="#urun" className="hover:text-white">Ürün</a><Link to="/login" className="hover:text-white">Giriş</Link></div>
                </div>
            </footer>
        </div>
    );
}
