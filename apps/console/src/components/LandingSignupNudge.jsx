import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, X } from 'lucide-react';

/** Lets the widget panel's close animation and the returning launcher settle before the card slides in. */
const SHOW_DELAY_MS = 700;

/**
 * Post-conversation signup prompt on the landing page: shown right after a
 * visitor closes a real conversation with our own embedded agent — the
 * moment they've just experienced the product — and points them at
 * building their own. Sits above the SDK launcher (bottom-right).
 */
export function LandingSignupNudge({ open, href, onDismiss }) {
    const { t } = useTranslation();
    const [shown, setShown] = useState(false);

    useEffect(() => {
        if (!open) return undefined;
        const timer = setTimeout(() => setShown(true), SHOW_DELAY_MS);
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onDismiss();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('keydown', onKeyDown);
            setShown(false);
        };
    }, [open, onDismiss]);

    if (!open) return null;

    return (
        <aside
            aria-label={t('landing.widget.followUp.label')}
            className={`fixed inset-x-4 bottom-[92px] z-[60] transition-all duration-500 ease-out motion-reduce:transition-none sm:inset-x-auto sm:right-6 sm:w-[360px] ${
                shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
            }`}
        >
            <div className="relative overflow-hidden rounded-3xl border border-white/12 bg-[#0f0a2e]/90 p-5 text-white shadow-[0_30px_70px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
                <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#8b5cf6]/30 blur-3xl" />
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={t('landing.widget.followUp.dismiss')}
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--lp-accent)]"
                >
                    <X size={16} />
                </button>
                <p className="relative text-[11px] font-extrabold uppercase tracking-[0.2em] text-[var(--lp-accent)]">
                    {t('landing.widget.followUp.eyebrow')}
                </p>
                <h3 className="relative mt-2 pr-8 text-lg font-bold leading-snug">{t('landing.widget.followUp.title')}</h3>
                <p className="relative mt-2 text-sm font-medium leading-6 text-white/60">{t('landing.widget.followUp.body')}</p>
                <Link
                    to={href}
                    className="group relative mt-4 flex h-11 items-center justify-center gap-2 lp-btn-primary rounded-full px-5 text-sm font-extrabold transition-all hover:-translate-y-0.5"
                >
                    {t('landing.widget.followUp.cta')}
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
            </div>
        </aside>
    );
}
