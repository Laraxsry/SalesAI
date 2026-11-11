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
    const [selectedValues, setSelectedValues] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    useEffect(() => {
        setFreeText('');
        setSelectedValue('');
        setSelectedValues([]);
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

    const showText = survey.answerType === 'text'
        || survey.answerType === 'short_text'
        || survey.answerType === 'number'
        || survey.allowFreeText;
    const multiSelect = survey.answerType === 'multi_select';
    const answerValue = freeText.trim() || selectedValue;
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4 sm:bottom-6">
            <section
                aria-labelledby={`survey-${survey.nodeId}`}
                className="pointer-events-auto w-full max-w-lg rounded-2xl border border-white/15 bg-(--color-shell)/88 p-4 shadow-2xl shadow-black/35 backdrop-blur-xl sm:p-5"
            >
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-(--color-accent)/80">
                            {survey.position && survey.total ? `${survey.position} / ${survey.total} · ` : ''}Kısa soru
                        </p>
                        <h2 id={`survey-${survey.nodeId}`} className="mt-1 text-sm font-semibold leading-5 text-white sm:text-base">
                            {survey.question}
                        </h2>
                    </div>
                    {submitting && <Loader2 size={17} className="mt-1 shrink-0 animate-spin text-(--color-accent)" />}
                </div>

                {survey.options.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {survey.options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                disabled={submitting}
                                aria-pressed={multiSelect
                                    ? selectedValues.includes(option.value)
                                    : selectedValue === option.value}
                                onClick={() => {
                                    if (multiSelect) {
                                        setSelectedValues((current) => current.includes(option.value)
                                            ? current.filter((value) => value !== option.value)
                                            : [...current, option.value]);
                                    } else {
                                        setSelectedValue(option.value);
                                    }
                                    setFreeText('');
                                    setSubmitError('');
                                }}
                                className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${
                                    (multiSelect ? selectedValues.includes(option.value) : selectedValue === option.value)
                                        ? 'border-(--color-accent) bg-[#8b5cf6]/35 shadow-[0_0_0_1px_rgba(196,181,253,0.55)]'
                                        : 'border-white/10 bg-white/[0.07] hover:border-(--color-accent)/60 hover:bg-white/[0.11]'
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
                            type={survey.answerType === 'number' ? 'number' : 'text'}
                            onChange={(event) => {
                                setFreeText(event.target.value);
                                if (event.target.value) setSelectedValue('');
                                setSubmitError('');
                            }}
                            disabled={submitting}
                            maxLength={1000}
                            placeholder={survey.options.length ? 'Diğer cevabınız…' : 'Cevabınız…'}
                            className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-(--color-accent)/70"
                        />
                        <button
                            type="submit"
                            disabled={submitting || !answerValue}
                            aria-label="Cevabı gönder"
                            className="flex h-10 w-11 items-center justify-center rounded-xl bg-[image:var(--gradient-primary)] text-white shadow-(--shadow-primary) disabled:opacity-50"
                        >
                            <Send size={16} />
                        </button>
                    </form>
                )}

                {!showText && survey.options.length > 0 && (
                    <button
                        type="button"
                        disabled={submitting || (multiSelect ? selectedValues.length === 0 : !selectedValue)}
                        onClick={() => submit(multiSelect ? selectedValues : selectedValue)}
                        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[image:var(--gradient-primary)] text-sm font-semibold text-white shadow-(--shadow-primary) transition hover:bg-[image:var(--gradient-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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
