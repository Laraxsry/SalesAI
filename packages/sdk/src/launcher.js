/**
 * Launcher bubble + conversation frame presentation for the embed loader:
 * copy/locale resolution and the Shadow DOM stylesheet. Kept apart from
 * index.js so the session/postMessage logic there stays readable and the
 * pure helpers here can be unit-tested without a DOM.
 */

/** The schema default for `launcher.label` (packages/contracts EmbedConfigInput). */
export const STOCK_LAUNCHER_LABEL = 'Talk to sales';

const COPY = {
    en: { label: STOCK_LAUNCHER_LABEL, error: 'Couldn’t connect. Try again' },
    tr: { label: 'Satış ekibiyle konuş', error: 'Bağlanamadı, tekrar dene' }
};

/**
 * Picks the launcher's UI language. The host page's `<html lang>` wins over
 * the browser language: a Turkish site visited from an English browser
 * should still read Turkish next to its own copy.
 */
export function resolveLocale({ documentLang, navigatorLanguage } = {}) {
    const lang = (documentLang || navigatorLanguage || '').toLowerCase();
    return lang.startsWith('tr') ? 'tr' : 'en';
}

export function launcherCopy(locale) {
    return COPY[locale] ?? COPY.en;
}

/**
 * Label precedence: explicit `init({ label })` / `setLabel()` from the host
 * page → a label the seller actually customized in the dashboard → the
 * localized default. The config endpoint always returns a label (the schema
 * fills in 'Talk to sales'), so the stock value is treated as "not
 * customized" — otherwise localization could never apply to any seller.
 */
export function resolveLauncherLabel({ override, configLabel, locale }) {
    if (override) return override;
    if (configLabel && configLabel !== STOCK_LAUNCHER_LABEL) return configLabel;
    return launcherCopy(locale).label;
}

/** CSS size of the launcher's voice orb canvas (keep in sync with `.orb` below). */
export const LAUNCHER_ORB_SIZE = 38;

/** One full loading-wave cycle: the sweep across the label plus a short rest. */
export const WAVE_CYCLE_MS = 1600;
// Each letter's hop takes ~30% of the cycle (see @keyframes sa-wave); the
// rest is what's left between the last letter landing and the next sweep.
const WAVE_HOP_MS = WAVE_CYCLE_MS * 0.3;
const WAVE_REST_MS = 250;

/**
 * Delay between neighbouring letters' hops. The cycle length is fixed, so
 * the stagger shrinks for long labels — a 40-character seller label sweeps
 * in the same calm rhythm as a short one instead of crawling.
 */
export function waveStepMs(charCount) {
    const gaps = Math.max(charCount - 1, 1);
    const step = (WAVE_CYCLE_MS - WAVE_HOP_MS - WAVE_REST_MS) / gaps;
    return Math.round(Math.min(Math.max(step, 18), 60));
}

/** Delay before the launcher first slides in, so it doesn't compete with the host page's own first paint. */
export const ENTRANCE_DELAY_MS = 1500;

/**
 * Everything is driven by one custom property, `--sa-primary`, set on the
 * shadow host from the seller's `theme.primaryColor`. Each color-mix()
 * declaration is preceded by a plain fallback so browsers without color-mix
 * still render a solid, on-brand launcher. `all: initial` keeps host-page
 * CSS out; `font-family: inherit` deliberately lets the site's font back in.
 */
export const LAUNCHER_CSS = `
.wrap {
    position: fixed;
    bottom: 24px;
    z-index: 2147483647;
    animation: sa-enter .6s cubic-bezier(.2, .8, .2, 1) ${ENTRANCE_DELAY_MS}ms backwards;
}
.wrap[hidden] { display: none; }
.wrap.is-returning { animation-delay: 0ms; }
.pos-right { right: 24px; }
.pos-left { left: 24px; }

.launcher {
    all: initial;
    font-family: inherit;
    box-sizing: border-box;
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 52px;
    padding: 0 22px 0 9px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, .22);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -.01em;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    -webkit-font-smoothing: antialiased;
    background: var(--sa-primary);
    background:
        radial-gradient(120% 140% at 20% 0%, rgba(255, 255, 255, .22), transparent 55%),
        linear-gradient(135deg,
            color-mix(in oklab, var(--sa-primary) 72%, white) 0%,
            var(--sa-primary) 50%,
            color-mix(in oklab, var(--sa-primary) 72%, black) 100%);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, .3),
        0 12px 32px -10px rgba(0, 0, 0, .45),
        0 2px 6px rgba(0, 0, 0, .18);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, .3),
        0 14px 36px -10px color-mix(in srgb, var(--sa-primary) 75%, transparent),
        0 2px 6px rgba(0, 0, 0, .18);
    transition: transform .22s cubic-bezier(.2, .8, .2, 1), box-shadow .22s ease, filter .22s ease;
}
@media (hover: hover) {
    .launcher:hover:not(:disabled) {
        transform: translateY(-2px);
        filter: brightness(1.06);
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, .34),
            0 20px 44px -12px rgba(0, 0, 0, .5),
            0 3px 8px rgba(0, 0, 0, .2);
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, .34),
            0 20px 44px -10px color-mix(in srgb, var(--sa-primary) 85%, transparent),
            0 3px 8px rgba(0, 0, 0, .2);
    }
}
.launcher:active:not(:disabled) { transform: scale(.97); transition-duration: .08s; }
.launcher:focus-visible {
    outline: 3px solid var(--sa-primary);
    outline: 3px solid color-mix(in oklab, var(--sa-primary) 55%, white);
    outline-offset: 3px;
}
.launcher:disabled { cursor: progress; }
.launcher.is-error { animation: sa-shake .45s cubic-bezier(.36, .07, .19, .97); }

/* The real SalesAI voice orb (shared canvas renderer from @repo/ui), drawn
   edge-to-edge in the chip; its own blurred glow is off at this size, so a
   soft drop-shadow stands in for it. */
.orb {
    display: block;
    flex: none;
    width: 38px;
    height: 38px;
    margin-left: -3px;
    filter: drop-shadow(0 0 6px rgba(236, 72, 153, .45));
    transition: transform .3s cubic-bezier(.2, .8, .2, 1), filter .3s ease;
}
@media (hover: hover) {
    .launcher:hover:not(:disabled) .orb {
        transform: scale(1.08);
        filter: drop-shadow(0 0 10px rgba(236, 72, 153, .7));
    }
}

.label { position: relative; display: inline-block; }

/* Connecting: instead of a spinner, the label itself does a "Mexican wave" —
   each letter hops in turn, left to right, then a short rest. The letters
   never leave the line, so the button keeps its width. */
.wave-char {
    display: inline-block;
    white-space: pre;
    animation: sa-wave ${WAVE_CYCLE_MS}ms cubic-bezier(.33, 0, .2, 1) calc(var(--i) * var(--sa-wave-step)) infinite both;
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
}

.frame {
    border: 0;
    position: fixed;
    bottom: 24px;
    z-index: 2147483647;
    width: 380px;
    height: 560px;
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, .35);
    animation: sa-open .34s cubic-bezier(.2, .9, .25, 1) both;
}
.frame.pos-right { transform-origin: calc(100% - 28px) calc(100% - 26px); }
.frame.pos-left { transform-origin: 28px calc(100% - 26px); }
.frame.is-closing { animation: sa-close .2s cubic-bezier(.4, 0, 1, 1) both; }
.frame {
    transition:
        width .4s cubic-bezier(.2, .9, .25, 1),
        height .4s cubic-bezier(.2, .9, .25, 1),
        right .4s cubic-bezier(.2, .9, .25, 1),
        left .4s cubic-bezier(.2, .9, .25, 1),
        bottom .4s cubic-bezier(.2, .9, .25, 1),
        border-radius .4s ease;
}
/* Expanded: ~90% of the viewport, still floating — the host page stays visible around it.
   !important beats the inline height the visitor app's resize messages set. */
.frame.is-expanded {
    width: 90vw !important;
    height: 90vh !important;
    bottom: 5vh;
    border-radius: 20px;
    box-shadow: 0 30px 90px -20px rgba(0, 0, 0, .6);
}
.frame.pos-right.is-expanded { right: 5vw; }
.frame.pos-left.is-expanded { left: 5vw; }

.backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    background: rgba(6, 4, 18, .32);
    opacity: 0;
    pointer-events: none;
    transition: opacity .3s ease;
}
.backdrop.is-visible { opacity: 1; pointer-events: auto; cursor: zoom-out; }
@media (max-width: 640px) {
    .frame {
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        border-radius: 0;
    }
}

@keyframes sa-enter {
    from { opacity: 0; transform: translateY(18px) scale(.94); visibility: hidden; }
    to { opacity: 1; transform: none; visibility: visible; }
}
@keyframes sa-open {
    from { opacity: 0; transform: scale(.55) translateY(16px); }
    to { opacity: 1; transform: none; }
}
@keyframes sa-close {
    from { opacity: 1; transform: none; }
    to { opacity: 0; transform: scale(.6) translateY(16px); }
}
@keyframes sa-wave {
    0%, 30%, 100% { transform: translateY(0); opacity: .72; }
    11% { transform: translateY(-5px); opacity: 1; }
    20% { transform: translateY(1px); opacity: .9; }
}
@keyframes sa-wave-fade {
    0%, 30%, 100% { opacity: .6; }
    11% { opacity: 1; }
}
@keyframes sa-shake {
    10%, 90% { transform: translateX(-1px); }
    20%, 80% { transform: translateX(3px); }
    30%, 50%, 70% { transform: translateX(-5px); }
    40%, 60% { transform: translateX(5px); }
}

@media (prefers-reduced-motion: reduce) {
    .wrap, .launcher, .orb, .frame, .backdrop {
        animation: none !important;
        transition: none !important;
    }
    /* Still signal progress, but by light alone — no movement. */
    .wave-char { animation-name: sa-wave-fade; }
}
`;
