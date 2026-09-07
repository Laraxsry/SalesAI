import { useEffect, useState } from 'react';
import { Loader2, Send, SkipForward } from 'lucide-react';

const SUBMIT_ERRORS = {
    'Answer no longer matches the active question': 'Bu soru artık aktif değil. Görüşmedeki güncel soru bekleniyor.',
    'Answer could not be saved': 'Cevabınız kaydedilemedi. Lütfen tekrar gönderin.',
    'survey answer acknowledgement timeout': 'Cevabınız için onay alınamadı. Lütfen tekrar deneyin.',
    'survey disconnected': 'Görüşme bağlantısı hazır değil. Bağlantı kurulduğunda tekrar deneyin.'
};

export function InCallSurvey({ survey, onAnswer }) {
    const [freeText, setFreeText] = useState('');
    const [selectedValue, setSelectedValue] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    useEffect(() => {
        setFreeText('');
        setSelectedValue('');
        setSubmitting(false);
        setSubmitError('');
    }, [survey?.nodeId]);

    if (!survey) return null;

    async function submit(value, options) {
        if (submitting) return;
        setSubmitting(true);
        setSubmitError('');
        try {
            await onAnswer(survey.nodeId, value, options);
            setSubmitting(false);
        } catch (error) {
            console.error('[SalesAI survey] Answer submission failed', {
                nodeId: survey.nodeId,
                name: error?.name,
                message: error?.message,
                stack: error?.stack
            });
            setSubmitting(false);
            setSubmitError(Object.hasOwn(SUBMIT_ERRORS, error?.message)
                ? SUBMIT_ERRORS[error.message]
                : 'Cevap gönderilemedi. Lütfen tekrar deneyin.');
        }
    }

    const showText = survey.answerType === 'text' || survey.allowFreeText;
    const answerValue = freeText.trim() || selectedValue;
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4 sm:bottom-6">
            <section
                aria-labelledby={`survey-${survey.nodeId}`}
                className="pointer-events-auto w-full max-w-lg rounded-2xl border border-white/15 bg-[#071713]/88 p-4 shadow-2xl shadow-black/35 backdrop-blur-xl sm:p-5"
            >
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#d7f95b]/80">
                            {survey.position && survey.total ? `${survey.position} / ${survey.total} · ` : ''}Kısa soru
                        </p>
                        <h2 id={`survey-${survey.nodeId}`} className="mt-1 text-sm font-semibold leading-5 text-white sm:text-base">
                            {survey.question}
                        </h2>
                    </div>
                    {submitting && <Loader2 size={17} className="mt-1 shrink-0 animate-spin text-[#d7f95b]" />}
                </div>

                {survey.options.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {survey.options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                disabled={submitting}
                                aria-pressed={selectedValue === option.value}
                                onClick={() => {
                                    setSelectedValue(option.value);
                                    setFreeText('');
                                    setSubmitError('');
                                }}
                                className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${
                                    selectedValue === option.value
                                        ? 'border-[#d7f95b] bg-[#d7f95b]/15 shadow-[0_0_0_1px_rgba(215,249,91,0.2)]'
                                        : 'border-white/10 bg-white/[0.07] hover:border-[#d7f95b]/60 hover:bg-white/[0.11]'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                )}

                {showText && (
                    <form
                        className={`${survey.options.length ? 'mt-3' : ''} flex gap-2`}
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (answerValue) submit(answerValue);
                        }}
                    >
                        <input
                            value={freeText}
                            onChange={(event) => {
                                setFreeText(event.target.value);
                                if (event.target.value) setSelectedValue('');
                                setSubmitError('');
                            }}
                            disabled={submitting}
                            maxLength={1000}
                            placeholder={survey.options.length ? 'Diğer cevabınız…' : 'Cevabınız…'}
                            className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#d7f95b]/70"
                        />
                        <button
                            type="submit"
                            disabled={submitting || !answerValue}
                            aria-label="Cevabı gönder"
                            className="flex h-10 w-11 items-center justify-center rounded-xl bg-[#d7f95b] text-[#071713] disabled:opacity-40"
                        >
                            <Send size={16} />
                        </button>
                    </form>
                )}

                {!showText && survey.options.length > 0 && (
                    <button
                        type="button"
                        disabled={submitting || !selectedValue}
                        onClick={() => submit(selectedValue)}
                        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#d7f95b] text-sm font-semibold text-[#071713] transition hover:bg-[#e1ff72] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Send size={16} /> Cevabı gönder
                    </button>
                )}

                {submitError && (
                    <p role="alert" className="mt-2 text-xs text-red-200">{submitError}</p>
                )}

                {!survey.required && (
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={() => submit('', { skipped: true })}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white/75 disabled:opacity-50"
                    >
                        <SkipForward size={13} /> Bu soruyu geç
                    </button>
                )}
            </section>
        </div>
    );
}
