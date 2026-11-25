import { useTranslation } from 'react-i18next';
import { Logo, VoiceOrb } from '@repo/ui';
import { LineChart, Mic, Moon, ScreenShare, ShieldCheck, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider.jsx';

// Same order as auth.sideChips.
const CHIP_ICONS = [Mic, ScreenShare, LineChart];

/** Gentle "breathing" level so the orb stays alive without a real voice. */
function idleLevel() {
    const t = performance.now() / 1000;
    return 0.18 + 0.1 * Math.sin(t * 1.7) + 0.06 * Math.sin(t * 4.3);
}

/**
 * Two-column shell shared by the login and register screens, in the landing
 * page's look: the night-sky hero with the voice orb on the left, the form
 * card on the right. Only the left panel is `lp-root` (the landing type ramp);
 * the form keeps the console's larger one.
 */
export function AuthLayout({ children }) {
    const { t } = useTranslation();
    const { isDark, toggleTheme } = useTheme();
    const chips = t('auth.sideChips', { returnObjects: true });
    const themeLabel = isDark ? t('landing.header.themeLight') : t('landing.header.themeDark');

    return (
        <div className="relative grid min-h-screen bg-bg lg:grid-cols-[1.08fr_0.92fr]">
            <button
                type="button"
                onClick={toggleTheme}
                title={themeLabel}
                aria-label={themeLabel}
                className="absolute right-5 top-5 z-30 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-text shadow-sm transition-colors hover:bg-surface-raised"
            >
                {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>

            {/* Same night sky as the landing hero. The 1px shadow is a hairline on
                the right edge, where the aurora is clipped. */}
            <div className="lp-root relative isolate hidden flex-col justify-between overflow-hidden bg-[var(--color-night)] p-10 text-white shadow-[1px_0_0_rgb(255_255_255/0.08)] lg:flex xl:p-14">
                <div className="lp-aurora pointer-events-none absolute inset-0" aria-hidden="true" />
                <div className="lp-stars absolute inset-0" aria-hidden="true" />

                <div className="relative z-10 flex items-center gap-3">
                    <Logo className="[&>span]:text-[20px] [&_span]:text-white [&_span_span]:text-[var(--color-accent)]" />
                </div>

                <div className="relative z-10 max-w-xl py-8">
                    <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.05] py-1.5 pl-1.5 pr-4 text-xs font-semibold text-white/70 backdrop-blur-xl">
                        <span className="rounded-full bg-[var(--color-accent)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--color-night)]">
                            {t('landing.hero.badge')}
                        </span>
                        {t('landing.hero.badgeText')}
                    </div>
                    <h2 className="font-display text-4xl font-bold leading-[1.02] tracking-[-0.04em] xl:text-[3.4rem]">
                        {t('landing.hero.titleLead')}
                        <span className="lp-gradient-text block">{t('landing.hero.titleAccent')}</span>
                    </h2>
                    <p className="mt-5 max-w-lg text-[15px] font-medium leading-7 text-white/55">{t('auth.sideSubtitle')}</p>

                    <div className="lp-orb-tile relative mt-9 flex h-[240px] items-center justify-center overflow-hidden rounded-[24px] pb-8">
                        <VoiceOrb size={160} mode="listening" getLevel={idleLevel} label={t('landing.call.orbLabel')} />
                        <ul className="absolute inset-x-4 bottom-4 flex flex-wrap justify-center gap-2">
                            {chips.map((label, index) => {
                                const Icon = CHIP_ICONS[index];
                                return (
                                    <li
                                        key={label}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-[#1a1145]/80 px-3 py-1.5 text-[11px] font-semibold text-white/80 backdrop-blur-xl"
                                    >
                                        <Icon size={12} className="text-[var(--color-accent)]" />
                                        {label}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>

                <div className="relative z-10 flex items-center justify-between text-xs text-white/55">
                    <span>© {new Date().getFullYear()} SalesAI</span>
                    <span className="flex items-center gap-1.5">
                        <ShieldCheck size={13} /> {t('auth.sideSecurity')}
                    </span>
                </div>
            </div>

            <div className="relative flex items-center justify-center overflow-hidden p-6 sm:p-12">
                <div className="lp-dots absolute inset-0" aria-hidden="true" />
                <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/8 blur-3xl" aria-hidden="true" />
                <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[var(--color-pink)]/8 blur-3xl" aria-hidden="true" />
                <div className="relative w-full max-w-[420px] rounded-[28px] border border-border bg-surface/85 p-7 shadow-(--shadow-float) backdrop-blur sm:p-9">
                    {children}
                </div>
            </div>
        </div>
    );
}
