import { useState } from 'react';
import { Logo, Sparkle } from '@repo/ui';
import { Check, Loader2, Star, X } from 'lucide-react';
import { NightSky } from './NightSky.jsx';
import { RestingOrb } from './RestingOrb.jsx';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';

const COMMENT_MAX = 1000;

const RATING_LABEL = {
    1: 'Hiç memnun kalmadım',
    2: 'Pek memnun kalmadım',
    3: 'Fena değildi',
    4: 'Memnun kaldım',
    5: 'Çok memnun kaldım'
};

/**
 * The screen shown after a call ends: the visitor rates the conversation
 * 1-5 and can leave a comment. Sent to POST /sessions/:id/feedback, which
 * authorizes it by the session's roomName (the same way /end does).
 */
export function PostCallFeedback({ embed, onClose, sessionId, roomName, visitorKey }) {
    const [rating, setRating] = useState(0);
    const [hovered, setHovered] = useState(0);
    const [comment, setComment] = useState('');
    const [status, setStatus] = useState('idle'); // idle | sending | sent | skipped | error
    const shown = hovered || rating;

    async function submit(event) {
        event.preventDefault();
        if (!rating || status === 'sending') return;
        setStatus('sending');
        try {
            const res = await fetch(`${API}/api/v1/sessions/${sessionId}/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomName,
                    rating,
                    comment: comment.trim() || undefined,
                    visitorKey: visitorKey || undefined
                })
            });
            setStatus(res.ok ? 'sent' : 'error');
        } catch {
            setStatus('error');
        }
    }

    const done = status === 'sent' || status === 'skipped';

    return (
        <div className="visitor-stage relative h-full overflow-hidden text-center">
            <NightSky />
            {embed && onClose && (
                <button type="button" onClick={onClose} aria-label="Widget'ı kapat" className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-surface/70 text-white/70 backdrop-blur-xl transition-colors hover:bg-surface-raised hover:text-white">
                    <X size={17} aria-hidden="true" />
                </button>
            )}
            {/* Scrolls instead of clipping when the widget or window is shorter than the card. */}
            <div className="relative z-10 flex h-full flex-col items-center overflow-y-auto px-6 py-4">
                <div className={`night-card my-auto w-full max-w-sm shrink-0 ${embed ? 'p-6' : 'p-8'}`}>
                    {!embed && (
                        <div className="mb-6 flex items-center justify-center gap-3">
                            <Logo className="[&_span]:text-white [&_span_span]:text-(--color-accent)" />
                        </div>
                    )}

                    <div className="relative mx-auto flex h-[104px] w-[104px] items-center justify-center">
                        {status === 'sent' ? (
                            <>
                                <span className="orb-badge__spark" aria-hidden="true"><Sparkle size={20} /></span>
                                <span className="feedback-orb__check flex h-16 w-16 items-center justify-center rounded-full text-white">
                                    <Check size={28} strokeWidth={2.4} />
                                </span>
                            </>
                        ) : (
                            <RestingOrb />
                        )}
                    </div>

                    {done ? (
                        <>
                            <p className="mt-5 text-lg font-bold tracking-[-0.01em] text-white">
                                {status === 'sent' ? 'Teşekkürler!' : 'Görüşme sona erdi.'}
                            </p>
                            <p className="mt-1.5 text-sm font-medium leading-6 text-white/55">
                                {status === 'sent' ? 'Değerlendirmeniz bize ulaştı.' : 'Bizimle görüştüğünüz için teşekkürler.'}
                            </p>
                        </>
                    ) : (
                        <form onSubmit={submit}>
                            <p className="mt-5 text-lg font-bold tracking-[-0.01em] text-white">Görüşme sona erdi.</p>
                            <p className="mt-1.5 text-sm font-medium leading-6 text-white/55">Görüşmeyi nasıl buldunuz?</p>

                            <div className="mt-5 flex justify-center gap-1.5" role="radiogroup" aria-label="Görüşme puanı" onMouseLeave={() => setHovered(0)}>
                                {[1, 2, 3, 4, 5].map((value) => {
                                    const active = value <= shown;
                                    return (
                                        <button
                                            key={value}
                                            type="button"
                                            role="radio"
                                            aria-checked={rating === value}
                                            aria-label={`${value} yıldız — ${RATING_LABEL[value]}`}
                                            onClick={() => setRating(value)}
                                            onMouseEnter={() => setHovered(value)}
                                            data-active={active || undefined}
                                            className="feedback-star rounded-xl p-1.5 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-(--color-accent)"
                                        >
                                            <Star
                                                size={30}
                                                strokeWidth={1.6}
                                                className={active ? 'fill-[#f0abfc] text-[#f0abfc]' : 'text-white/25'}
                                            />
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="mt-2 h-5 text-xs font-semibold text-[#f9a8d4]" aria-live="polite">
                                {shown ? RATING_LABEL[shown] : ''}
                            </p>

                            {rating > 0 && (
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    maxLength={COMMENT_MAX}
                                    rows={3}
                                    placeholder="Eklemek istediğiniz bir şey var mı? (isteğe bağlı)"
                                    className="mt-4 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-left text-sm text-white placeholder:text-white/35 outline-none focus:border-(--color-accent)"
                                />
                            )}

                            {status === 'error' && (
                                <p className="mt-3 text-xs font-medium text-red-300">Gönderilemedi, lütfen tekrar deneyin.</p>
                            )}

                            <button
                                type="submit"
                                disabled={!rating || status === 'sending'}
                                className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[image:var(--gradient-primary)] text-sm font-bold text-white shadow-(--shadow-primary) transition-opacity enabled:hover:bg-[image:var(--gradient-primary-hover)] disabled:cursor-not-allowed disabled:opacity-35"
                            >
                                {status === 'sending' && <Loader2 size={16} className="animate-spin" />}
                                Gönder
                            </button>
                            <button
                                type="button"
                                onClick={() => setStatus('skipped')}
                                className="mt-2 text-xs font-medium text-white/45 transition-colors hover:text-white/75"
                            >
                                Şimdi değil
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
