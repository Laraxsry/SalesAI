import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Logo, VoiceOrb } from '@repo/ui';
import {
    ArrowRight,
    ArrowUpRight,
    AudioLines,
    Bot,
    BookOpen,
    ChartColumn,
    Check,
    ChevronDown,
    EyeOff,
    Languages,
    LockKeyhole,
    MonitorUp,
    Moon,
    MousePointerClick,
    Plus,
    ScanLine,
    ShieldCheck,
    Sparkles,
    Sun,
    Target,
    Timer,
    Zap
} from 'lucide-react';
import { useTheme } from '../lib/ThemeProvider.jsx';
import { useAuthStore } from '../store/auth.js';
import { ProductFilm } from '../components/ProductFilm.jsx';

const NAV = [
    ['#urun', 'product'],
    ['#deneyim', 'experience'],
    ['#nasil-calisir', 'how'],
    ['#guvenlik', 'security'],
    ['#sss', 'faq']
];

const LANGUAGES = ['tr', 'en'];

// Scripted demo call for the hero card: the orb "speaks" on AI lines and
// "listens" on visitor lines.
const DEMO_LINE_MS = 3600;

const RIBBON_ICONS = [AudioLines, ScanLine, MousePointerClick, BookOpen, Target, Languages];
const FEATURE_ICONS = [MonitorUp, MousePointerClick, BookOpen, Target, ChartColumn];
const FLOW_ICONS = [BookOpen, Bot, Zap];
const TRUST_ICONS = [LockKeyhole, MousePointerClick, EyeOff];

const WAVE_HEIGHTS = [18, 36, 24, 54, 30, 68, 42, 58, 26, 46, 20, 34, 56, 28, 44, 18];

/** Speech-like envelope (syllables inside phrases) for the demo orb. */
function syntheticSpeech(t) {
    const syllable = Math.max(0, Math.sin(t * 9.4)) ** 1.4;
    const phrase = 0.55 + 0.45 * Math.sin(t * 2.2 + Math.sin(t * 0.7) * 2);
    return Math.min(1, syllable * phrase * 0.9 + 0.05);
}

function useDemoCall(length) {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setIndex((value) => (value + 1) % length), DEMO_LINE_MS);
        return () => clearInterval(timer);
    }, [length]);
    return index;
}

/** Adds `is-visible` to `[data-reveal]` elements as they scroll into view. */
function useScrollReveal() {
    const rootRef = useRef(null);
    useEffect(() => {
        const nodes = rootRef.current?.querySelectorAll('[data-reveal]') ?? [];
        if (!('IntersectionObserver' in window)) {
            nodes.forEach((node) => node.classList.add('is-visible'));
            return undefined;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            },
            { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
        );
        nodes.forEach((node) => observer.observe(node));
        return () => observer.disconnect();
    }, []);
    return rootRef;
}

function Waveform({ label }) {
    return (
        <div className="wow-wave flex h-20 items-center justify-center gap-1" aria-label={label}>
            {WAVE_HEIGHTS.map((height, index) => (
                <span key={`${height}-${index}`} style={{ '--wave-height': `${height}px`, '--wave-delay': `${index * 55}ms` }} />
            ))}
        </div>
    );
}

function SectionEyebrow({ children, tone = 'brand' }) {
    return (
        <p className={`text-[11px] font-extrabold uppercase tracking-[0.2em] ${tone === 'accent' ? 'text-[var(--lp-accent)]' : 'text-brand'}`}>
            {children}
        </p>
    );
}

function LanguageSwitch() {
    const { t, i18n } = useTranslation();
    const current = LANGUAGES.includes(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'tr';

    useEffect(() => {
        document.documentElement.lang = current;
    }, [current]);

    return (
        <div role="group" aria-label={t('landing.header.language')} className="flex h-9 items-center rounded-full border border-white/12 bg-white/[0.05] p-0.5">
            {LANGUAGES.map((lang) => (
                <button
                    key={lang}
                    type="button"
                    onClick={() => i18n.changeLanguage(lang)}
                    aria-pressed={current === lang}
                    className={`h-8 rounded-full px-2.5 text-[11px] font-extrabold uppercase tracking-[0.08em] transition-colors ${
                        current === lang ? 'bg-white text-[#1a1145]' : 'text-white/60 hover:text-white'
                    }`}
                >
                    {lang}
                </button>
            ))}
        </div>
    );
}

/** Hero centerpiece: a live call card with the audio-reactive orb. */
function HeroCall() {
    const { t } = useTranslation();
    const lines = t('landing.call.lines', { returnObjects: true });
    const stats = t('landing.call.stats', { returnObjects: true });
    const index = useDemoCall(lines.length);
    const line = lines[index % lines.length];
    const speaking = line.speaker === 'ai';
    const getLevel = () => syntheticSpeech(performance.now() / 1000) * (speaking ? 1 : 0.55);

    return (
        <div className="lp-hero-card relative mx-auto w-full max-w-[460px]">
            <div className="lp-hero-card__inner relative overflow-hidden rounded-[32px] border border-white/12 bg-[#140e38]/80 p-6 text-white shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-7">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07] text-[var(--lp-accent)]"><Bot size={17} /></span>
                        <div>
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.17em] text-white/40">{t('landing.call.live')}</p>
                            <p className="mt-0.5 text-sm font-bold">{t('landing.call.title')}</p>
                        </div>
                    </div>
                    <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--lp-accent)]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--lp-accent)]" /> {t('landing.call.liveBadge')}
                    </span>
                </div>

                <div className="lp-orb-tile relative mt-6 flex h-[248px] items-center justify-center overflow-hidden rounded-[22px]">
                    <VoiceOrb size={210} mode={speaking ? 'speaking' : 'listening'} getLevel={getLevel} label={t('landing.call.orbLabel')} />
                    <span className="absolute bottom-4 left-5 text-[13px] font-semibold text-white/85">{t('landing.call.ai')}</span>
                </div>
                <p className="mt-5 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
                    {speaking ? t('landing.call.speaking') : t('landing.call.listening')}
                </p>

                <div className="mt-6 min-h-[86px]" aria-live="polite">
                    <div
                        key={index}
                        className={`lp-bubble flex max-w-[88%] flex-col gap-1 rounded-2xl px-4 py-3 text-sm font-semibold leading-6 ${
                            speaking
                                ? 'ml-auto rounded-br-md bg-[var(--lp-accent)] text-[#1a1145]'
                                : 'rounded-bl-md border border-white/10 bg-white/[0.06] text-white/85'
                        }`}
                    >
                        <span className={`text-[10px] font-extrabold uppercase tracking-[0.14em] ${speaking ? 'text-[#1a1145]/55' : 'text-white/40'}`}>
                            {speaking ? t('landing.call.ai') : t('landing.call.visitor')}
                        </span>
                        {line.text}
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/8 pt-5">
                    {stats.map(([label, value]) => (
                        <div key={label} className="rounded-xl bg-white/[0.04] px-3 py-2.5">
                            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/35">{label}</p>
                            <p className="mt-1 text-xs font-extrabold text-white">{value}</p>
                        </div>
                    ))}
                </div>
            </div>
            <div className="lp-hero-chip absolute -left-10 top-24 hidden items-center gap-2 rounded-2xl border border-white/12 bg-[#1a1145]/90 px-3.5 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-xl xl:flex">
                <ScanLine size={15} className="text-[var(--lp-accent)]" /> {t('landing.call.chipScreen')}
            </div>
            <div className="lp-hero-chip lp-hero-chip--late absolute -right-8 bottom-28 hidden items-center gap-2 rounded-2xl border border-white/12 bg-[#1a1145]/90 px-3.5 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-xl xl:flex">
                <Sparkles size={15} className="text-[#f6c85f]" /> {t('landing.call.chipLead')}
            </div>
        </div>
    );
}

function Faq() {
    const { t } = useTranslation();
    const items = t('landing.faq.items', { returnObjects: true });
    const [open, setOpen] = useState(0);

    return (
        <section id="sss" className="relative scroll-mt-24 px-5 py-24 sm:px-8 lg:py-32">
            <div className="lp-dots absolute inset-0" aria-hidden="true" />
            <div className="relative mx-auto grid w-full max-w-[1240px] gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
                <div data-reveal className="lp-reveal lg:sticky lg:top-32 lg:self-start">
                    <SectionEyebrow>{t('landing.faq.eyebrow')}</SectionEyebrow>
                    <h2 className="mt-4 text-4xl font-bold leading-tight tracking-[-0.04em] text-text sm:text-5xl">{t('landing.faq.title')}</h2>
                    <p className="mt-5 max-w-md text-sm font-medium leading-7 text-text-muted">{t('landing.faq.subtitle')}</p>
                </div>
                <div data-reveal className="lp-reveal border-t border-border">
                    {items.map(({ q, a }, index) => {
                        const expanded = open === index;
                        return (
                            <div key={index} className="border-b border-border">
                                <h3>
                                    <button
                                        type="button"
                                        id={`faq-q-${index}`}
                                        aria-expanded={expanded}
                                        aria-controls={`faq-a-${index}`}
                                        onClick={() => setOpen(expanded ? -1 : index)}
                                        className="flex w-full items-center justify-between gap-6 py-6 text-left text-base font-bold text-text transition-colors hover:text-brand sm:text-lg"
                                    >
                                        {q}
                                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition-transform duration-300 ${expanded ? 'rotate-45 border-brand text-brand' : ''}`}>
                                            <Plus size={16} />
                                        </span>
                                    </button>
                                </h3>
                                <div
                                    id={`faq-a-${index}`}
                                    role="region"
                                    aria-labelledby={`faq-q-${index}`}
                                    className={`grid transition-[grid-template-rows] duration-300 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                                >
                                    <div className="overflow-hidden">
                                        <p className="max-w-[640px] pb-6 pr-12 text-sm font-medium leading-7 text-text-muted sm:text-[15px]">{a}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

export function Landing() {
    const { t } = useTranslation();
    const accessToken = useAuthStore((state) => state.accessToken);
    const { isDark, toggleTheme } = useTheme();
    const primaryHref = accessToken ? '/' : '/register';
    const rootRef = useScrollReveal();
    const [scrolled, setScrolled] = useState(false);

    const checks = t('landing.hero.checks', { returnObjects: true });
    const ribbon = t('landing.ribbon', { returnObjects: true });
    const features = t('landing.product.features', { returnObjects: true });
    const steps = t('landing.how.steps', { returnObjects: true });
    const trust = t('landing.security.items', { returnObjects: true });

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 24);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <div ref={rootRef} className="lp-root min-h-screen overflow-hidden bg-bg text-text">
            <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
                <div
                    className={`mx-auto flex h-[62px] w-full max-w-[1240px] items-center justify-between rounded-full border px-4 text-white transition-all duration-300 sm:px-5 ${
                        scrolled
                            ? 'border-white/12 bg-[#0f0a2e]/80 shadow-[0_20px_50px_-25px_rgba(0,0,0,0.8)] backdrop-blur-2xl'
                            : 'border-transparent bg-transparent'
                    }`}
                >
                    <Link to="/mainpage" aria-label={t('landing.header.home')} className="shrink-0 pl-1">
                        <Logo className="[&_span]:text-white [&_span_span]:text-[var(--lp-accent)]" />
                    </Link>
                    <nav className="hidden items-center gap-1 lg:flex" aria-label={t('landing.header.menu')}>
                        {NAV.map(([href, key]) => (
                            <a key={href} href={href} className="rounded-full px-4 py-2 text-[13px] font-semibold text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white">{t(`landing.nav.${key}`)}</a>
                        ))}
                    </nav>
                    <div className="flex items-center gap-2">
                        <LanguageSwitch />
                        <button
                            type="button"
                            onClick={toggleTheme}
                            aria-label={isDark ? t('landing.header.themeLight') : t('landing.header.themeDark')}
                            title={isDark ? t('landing.header.themeLight') : t('landing.header.themeDark')}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            {isDark ? <Sun size={15} /> : <Moon size={15} />}
                        </button>
                        {!accessToken && <Link to="/login" className="hidden px-3 text-[13px] font-semibold text-white/70 transition-colors hover:text-white sm:block">{t('landing.header.login')}</Link>}
                        <Link to={primaryHref} className="group hidden h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#1a1145] transition-colors hover:bg-[#ddd6fe] sm:flex">
                            {accessToken ? t('landing.header.backToConsole') : t('landing.header.start')} <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </Link>
                    </div>
                </div>
            </header>

            <main>
                <section className="lp-hero relative overflow-hidden bg-[#0b0726] text-white">
                    <div className="lp-aurora absolute inset-0" aria-hidden="true" />
                    <div className="lp-stars absolute inset-0" aria-hidden="true" />
                    <div className="wow-hero-noise absolute inset-0 opacity-30" aria-hidden="true" />

                    <div className="relative z-10 mx-auto grid w-full max-w-[1240px] items-center gap-16 px-5 pb-24 pt-36 sm:px-8 lg:min-h-[100svh] lg:grid-cols-[1.08fr_0.92fr] lg:gap-10 lg:pb-20 lg:pt-32">
                        <div className="wow-reveal">
                            <div className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.05] py-1.5 pl-1.5 pr-4 text-xs font-semibold text-white/70 backdrop-blur-xl">
                                <span className="rounded-full bg-[var(--lp-accent)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#1a1145]">{t('landing.hero.badge')}</span>
                                {t('landing.hero.badgeText')}
                            </div>
                            <h1 className="font-display text-[clamp(2.9rem,6.4vw,5.6rem)] font-bold leading-[0.98] tracking-[-0.045em]">
                                {t('landing.hero.titleLead')}
                                <span className="lp-gradient-text block">{t('landing.hero.titleAccent')}</span>
                            </h1>
                            <p className="mt-7 max-w-[560px] text-base font-medium leading-7 text-white/60 sm:text-lg sm:leading-8">{t('landing.hero.subtitle')}</p>
                            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                                <Link to={primaryHref} className="group flex h-12 items-center justify-center gap-2.5 lp-btn-primary rounded-full px-7 text-sm font-extrabold transition-all hover:-translate-y-0.5">
                                    {accessToken ? t('landing.hero.primaryAuthed') : t('landing.hero.primary')} <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                                </Link>
                                <a href="#deneyim" className="flex h-12 items-center justify-center gap-2.5 rounded-full border border-white/15 bg-white/[0.04] px-7 text-sm font-bold text-white backdrop-blur-xl transition-colors hover:bg-white/10">
                                    {t('landing.hero.secondary')} <ChevronDown size={16} />
                                </a>
                            </div>
                            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-white/50">
                                {checks.map((item, index) => (
                                    <span key={index} className="flex items-center gap-2"><Check size={14} className="text-[var(--lp-accent)]" strokeWidth={3} />{item}</span>
                                ))}
                            </div>
                        </div>

                        <HeroCall />
                    </div>

                    <div className="relative z-10 border-t border-white/8 bg-white/[0.02]">
                        <div className="lp-ribbon mx-auto flex w-full max-w-[1240px] gap-8 overflow-x-auto px-5 py-5 sm:px-8 lg:justify-between">
                            {ribbon.map((label, index) => {
                                const Icon = RIBBON_ICONS[index];
                                return (
                                    <span key={index} className="flex shrink-0 items-center gap-2.5 text-[13px] font-semibold text-white/55">
                                        <Icon size={16} className="text-[var(--lp-accent)]" /> {label}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                </section>

                <section id="urun" className="relative scroll-mt-24 px-5 py-24 sm:px-8 lg:py-32">
                    <div className="lp-dots absolute inset-0" aria-hidden="true" />
                    <div className="relative mx-auto w-full max-w-[1240px]">
                        <div data-reveal className="lp-reveal mx-auto max-w-[760px] text-center">
                            <SectionEyebrow>{t('landing.product.eyebrow')}</SectionEyebrow>
                            <h2 className="mt-4 text-[clamp(2.2rem,4.6vw,3.9rem)] font-bold leading-[1.04] tracking-[-0.04em] text-text">
                                {t('landing.product.titleLead')} <span className="text-brand">{t('landing.product.titleAccent')}</span> {t('landing.product.titleTail')}
                            </h2>
                            <p className="mx-auto mt-5 max-w-[580px] text-base font-medium leading-7 text-text-muted">{t('landing.product.subtitle')}</p>
                        </div>

                        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            <article data-reveal className="lp-reveal lp-card relative overflow-hidden rounded-[28px] bg-[#140d38] p-8 text-white outline outline-1 -outline-offset-1 outline-white/10 md:col-span-2 lg:row-span-2">
                                <div className="lp-card-glow absolute -right-24 -top-24 h-80 w-80 rounded-full" aria-hidden="true" />
                                <div className="relative z-10 flex h-full flex-col">
                                    <div className="flex items-center justify-between">
                                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.07] text-[var(--lp-accent)]"><AudioLines size={20} /></span>
                                        <span className="font-display text-xs font-bold text-white/30">{t('landing.product.voiceTag')}</span>
                                    </div>
                                    <div className="my-10 flex flex-1 items-center justify-center gap-10 lg:my-6">
                                        <VoiceOrb size={150} mode="speaking" getLevel={() => syntheticSpeech(performance.now() / 1000 + 1.7)} label={t('landing.product.voiceOrbLabel')} />
                                        <div className="hidden w-[180px] sm:block"><Waveform label={t('landing.product.waveLabel')} /></div>
                                    </div>
                                    <h3 className="max-w-lg text-3xl font-bold leading-tight tracking-[-0.03em] sm:text-4xl">{t('landing.product.voiceTitle')}</h3>
                                    <p className="mt-4 max-w-lg text-sm font-medium leading-6 text-white/55">{t('landing.product.voiceText')}</p>
                                </div>
                            </article>

                            {features.map(({ lead, rest, description }, index) => {
                                const Icon = FEATURE_ICONS[index];
                                return (
                                    <article
                                        key={index}
                                        data-reveal
                                        style={{ '--reveal-delay': `${(index % 3) * 70}ms` }}
                                        className="lp-reveal lp-card group rounded-[28px] border border-border bg-surface p-7"
                                    >
                                        <div className="flex items-start justify-between">
                                            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-[var(--color-surface)]"><Icon size={20} /></span>
                                            <a href="#deneyim" aria-label={t('landing.hero.secondary')} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-muted transition-colors group-hover:border-brand group-hover:text-brand"><ArrowUpRight size={15} /></a>
                                        </div>
                                        <h3 className="mt-8 text-xl font-bold tracking-[-0.02em] text-text">{lead} <span className="text-text-muted">{rest}</span></h3>
                                        <p className="mt-2.5 text-sm font-medium leading-6 text-text-muted">{description}</p>
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                </section>

                <section id="deneyim" className="wow-stage-section relative scroll-mt-16 overflow-hidden bg-[#0b0726] px-5 py-24 text-white sm:px-8 lg:py-32">
                    <div className="wow-stage-glow absolute left-1/2 top-1/3 h-[680px] w-[900px] -translate-x-1/2 rounded-full bg-[#6d28d9]/25 blur-[130px]" aria-hidden="true" />
                    <div className="relative z-10 mx-auto w-full max-w-[1240px]">
                        <div data-reveal className="lp-reveal mb-14 flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
                            <div>
                                <SectionEyebrow tone="accent">{t('landing.experience.eyebrow')}</SectionEyebrow>
                                <h2 className="mt-4 max-w-[760px] text-4xl font-bold leading-[1.02] tracking-[-0.04em] sm:text-6xl">
                                    {t('landing.experience.titleLead')} <span className="text-white/40">{t('landing.experience.titleMuted')}</span>
                                </h2>
                            </div>
                            <p className="max-w-sm text-sm font-medium leading-7 text-white/50">{t('landing.experience.subtitle')}</p>
                        </div>
                        <div data-reveal className="lp-reveal">
                            <ProductFilm />
                        </div>
                    </div>
                </section>

                <section id="nasil-calisir" className="relative scroll-mt-24 px-5 py-24 sm:px-8 lg:py-32">
                    <div className="lp-dots absolute inset-0" aria-hidden="true" />
                    <div className="relative mx-auto w-full max-w-[1240px]">
                        <div data-reveal className="lp-reveal flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
                            <div>
                                <SectionEyebrow>{t('landing.how.eyebrow')}</SectionEyebrow>
                                <h2 className="mt-4 text-4xl font-bold leading-tight tracking-[-0.04em] text-text sm:text-5xl">{t('landing.how.title')}</h2>
                            </div>
                            <p className="max-w-md text-sm font-medium leading-7 text-text-muted">{t('landing.how.subtitle')}</p>
                        </div>

                        <ol className="lp-steps relative mt-14 grid gap-4 lg:grid-cols-3">
                            {steps.map(({ title, description }, index) => {
                                const Icon = FLOW_ICONS[index];
                                return (
                                    <li
                                        key={index}
                                        data-reveal
                                        style={{ '--reveal-delay': `${index * 90}ms` }}
                                        className="lp-reveal lp-card relative rounded-[28px] border border-border bg-surface p-7 sm:p-8"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-[var(--color-surface)] shadow-[0_14px_30px_-14px_var(--color-brand)]"><Icon size={20} /></span>
                                            <span className="font-display text-4xl font-bold text-text/[0.08]">{String(index + 1).padStart(2, '0')}</span>
                                        </div>
                                        <h3 className="mt-10 text-2xl font-bold tracking-[-0.025em] text-text">{title}</h3>
                                        <p className="mt-3 text-sm font-medium leading-6 text-text-muted">{description}</p>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                </section>

                <section id="guvenlik" className="scroll-mt-24 px-5 pb-24 sm:px-8 lg:pb-32">
                    <div data-reveal className="lp-reveal relative mx-auto w-full max-w-[1240px] overflow-hidden rounded-[32px] border border-white/10 bg-[#140d38] text-white">
                        <div className="lp-card-glow absolute -left-32 -top-40 h-[420px] w-[420px] rounded-full" aria-hidden="true" />
                        <div className="relative z-10 grid gap-12 p-8 sm:p-12 lg:grid-cols-[1fr_1.1fr] lg:p-16">
                            <div>
                                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.07] text-[var(--lp-accent)]"><ShieldCheck size={22} /></span>
                                <div className="mt-10"><SectionEyebrow tone="accent">{t('landing.security.eyebrow')}</SectionEyebrow></div>
                                <h2 className="mt-4 max-w-[520px] text-4xl font-bold leading-[1.04] tracking-[-0.04em] sm:text-5xl">{t('landing.security.title')}</h2>
                                <p className="mt-5 max-w-md text-sm font-medium leading-7 text-white/55">{t('landing.security.subtitle')}</p>
                            </div>
                            <div className="grid gap-3">
                                {trust.map(({ title, description }, index) => {
                                    const Icon = TRUST_ICONS[index];
                                    return (
                                        <div key={index} className="flex gap-4 rounded-2xl border border-white/8 bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.06]">
                                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--lp-accent)]/10 text-[var(--lp-accent)]"><Icon size={18} /></span>
                                            <div>
                                                <h3 className="text-base font-bold">{title}</h3>
                                                <p className="mt-1 text-sm font-medium leading-6 text-white/50">{description}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="lp-cta relative overflow-hidden bg-[#0b0726] px-5 py-28 text-white sm:px-8 lg:py-36">
                    <div className="lp-aurora absolute inset-0 opacity-80" aria-hidden="true" />
                    <div className="lp-stars absolute inset-0" aria-hidden="true" />
                    <div data-reveal className="lp-reveal relative z-10 mx-auto flex w-full max-w-[820px] flex-col items-center text-center">
                        <VoiceOrb size={112} mode="speaking" getLevel={() => syntheticSpeech(performance.now() / 1000 + 3.1) * 0.7} label={t('landing.cta.orbLabel')} />
                        <h2 className="mt-10 text-[clamp(2.4rem,5.4vw,4.6rem)] font-bold leading-[1] tracking-[-0.045em]">{t('landing.cta.title')}</h2>
                        <p className="mt-6 max-w-[520px] text-base font-medium leading-7 text-white/55">{t('landing.cta.subtitle')}</p>
                        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                            <Link to={primaryHref} className="group flex h-12 items-center justify-center gap-2.5 lp-btn-primary rounded-full px-7 text-sm font-extrabold transition-all hover:-translate-y-0.5">
                                {accessToken ? t('landing.header.backToConsole') : t('landing.cta.primary')} <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                            </Link>
                            {!accessToken && (
                                <Link to="/login" className="flex h-12 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-7 text-sm font-bold text-white transition-colors hover:bg-white/10">{t('landing.cta.secondary')}</Link>
                            )}
                        </div>
                        <p className="mt-8 flex items-center gap-2 text-xs font-semibold text-white/40"><Timer size={14} /> {t('landing.cta.note')}</p>
                    </div>
                </section>

                <Faq />
            </main>

            <footer className="border-t border-white/8 bg-[#0b0726] px-5 pb-10 pt-14 text-white sm:px-8">
                <div className="mx-auto w-full max-w-[1240px]">
                    <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
                        <div>
                            <Logo className="[&_span]:text-white [&_span_span]:text-[var(--lp-accent)]" />
                            <p className="mt-4 max-w-xs text-sm font-medium leading-6 text-white/45">{t('landing.footer.tagline')}</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/35">{t('landing.footer.explore')}</p>
                            <ul className="mt-4 space-y-2.5 text-sm font-semibold text-white/60">
                                {NAV.map(([href, key]) => <li key={href}><a href={href} className="transition-colors hover:text-white">{t(`landing.nav.${key}`)}</a></li>)}
                            </ul>
                        </div>
                        <div>
                            <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/35">{t('landing.footer.account')}</p>
                            <ul className="mt-4 space-y-2.5 text-sm font-semibold text-white/60">
                                <li><Link to="/login" className="transition-colors hover:text-white">{t('landing.footer.login')}</Link></li>
                                <li><Link to="/register" className="transition-colors hover:text-white">{t('landing.footer.register')}</Link></li>
                            </ul>
                        </div>
                    </div>
                    <div className="mt-12 flex flex-col gap-3 border-t border-white/8 pt-6 text-xs font-medium text-white/35 sm:flex-row sm:items-center sm:justify-between">
                        <span>© {new Date().getFullYear()} SalesAI</span>
                        <span>{t('landing.footer.motto')}</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
