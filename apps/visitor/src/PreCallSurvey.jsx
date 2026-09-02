import { useEffect, useRef, useState } from 'react';
import { Logo } from '@repo/ui';
import { Loader2, SkipForward } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/**
 * Görev #7 — the AI-generated adaptive pre-call questionnaire. Shown after the
 * name screen when the agent has `preCallSurveyEnabled` (1-on-1 only). Each
 * answer is POSTed back and the next question comes from the LLM; when it has
 * enough, a per-visitor tour plan is built and its opaque `planToken` handed up.
 *
 * Any failure → `onComplete(null)` and the call proceeds with no plan.
 */
export function PreCallSurvey({ token, onComplete }) {
    const [phase, setPhase] = useState('loading'); // loading | question | finalizing | preview
    const [question, setQuestion] = useState(null);
    const [freeText, setFreeText] = useState('');
    const [preview, setPreview] = useState(null);
    const planTokenRef = useRef(null);
    const answersRef = useRef([]);
    const startedRef = useRef(false);

    async function post(path, body) {
        const res = await fetch(`${API}/api/v1/prejoin/${token}/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
    }

    async function requestNext() {
        setPhase('loading');
        try {
            const data = await post('survey', { answers: answersRef.current });
            if (data.done) {
                if (data.unavailable) {
                    onComplete(null); // LLM unavailable — proceed without a survey
                    return;
                }
                await finalize();
            } else {
                setQuestion(data.question);
                setFreeText('');
                setPhase('question');
            }
        } catch {
            onComplete(null);
        }
    }

    async function finalize() {
        setPhase('finalizing');
        try {
            const data = await post('finalize', { answers: answersRef.current });
            planTokenRef.current = data.planToken || null;
            if (data.planToken && Array.isArray(data.preview) && data.preview.length) {
                setPreview(data.preview);
                setPhase('preview');
            } else {
                onComplete(planTokenRef.current);
            }
        } catch {
            onComplete(null);
        }
    }

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        requestNext();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function answer(value) {
        const a = String(value || '').trim();
        if (!a) return;
        answersRef.current = [...answersRef.current, { q: question?.text || '', a }];
        requestNext();
    }

    const shell = (children) => (
        <div className="visitor-stage relative flex h-full flex-col items-center justify-center overflow-hidden px-6 text-center">
            <div className="visitor-grid pointer-events-none absolute inset-0 opacity-50" />
            <div className="relative z-10 w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.055] p-8 shadow-2xl shadow-black/20 backdrop-blur-xl">
                <div className="mb-6 flex items-center justify-center">
                    <Logo className="[&_span]:text-white [&_span_span]:text-[#d7f95b]" />
                </div>
                {children}
            </div>
        </div>
    );

    if (phase === 'loading' || phase === 'finalizing') {
        return shell(
            <div className="flex flex-col items-center gap-4 py-6">
                <Loader2 size={24} className="animate-spin text-[#d7f95b]" />
                <p className="text-sm font-medium text-white/70">
                    {phase === 'finalizing'
                        ? 'Size özel bir tur planı hazırlanıyor…'
                        : answersRef.current.length === 0
                          ? 'Birkaç kısa soru hazırlanıyor…'
                          : 'Cevabınıza göre bir sonraki soru hazırlanıyor…'}
                </p>
            </div>
        );
    }

    if (phase === 'preview') {
        return shell(
            <>
                <p className="mb-3 text-sm font-semibold text-white">Size özel plan hazır</p>
                <ul className="mb-5 space-y-1.5 text-left">
                    {preview.map((s, i) => (
                        <li key={i} className="flex gap-2 text-sm text-white/70">
                            <span className="text-[#d7f95b]">{i + 1}.</span>
                            <span>{s.label}</span>
                        </li>
                    ))}
                </ul>
                <button
                    type="button"
                    onClick={() => onComplete(planTokenRef.current)}
                    className="w-full rounded-xl bg-[#d7f95b] px-4 py-2.5 text-sm font-bold text-[#071713] hover:bg-[#c9ed45]"
                >
                    Görüşmeye başla
                </button>
            </>
        );
    }

    // phase === 'question'
    return shell(
        <>
            <p className="mb-1 text-xs font-medium text-white/40">
                {answersRef.current.length + 1}. soru · isterseniz atlayabilirsiniz
            </p>
            <p className="mb-5 text-[15px] font-medium leading-6 text-white/85">{question?.text}</p>

            <div className="flex flex-col gap-2">
                {(question?.options || []).map((opt) => (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => answer(opt)}
                        className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm text-white hover:border-[#d7f95b]/60 hover:bg-white/[0.1]"
                    >
                        {opt}
                    </button>
                ))}
            </div>

            {question?.allowFreeText !== false && (
                <form
                    className="mt-3 flex gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        answer(freeText);
                    }}
                >
                    <input
                        value={freeText}
                        onChange={(e) => setFreeText(e.target.value)}
                        maxLength={500}
                        placeholder={question?.options?.length ? 'Veya kendiniz yazın…' : 'Cevabınız…'}
                        className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none focus:border-[#d7f95b]"
                    />
                    <button
                        type="submit"
                        disabled={!freeText.trim()}
                        className="rounded-xl bg-[#d7f95b] px-4 text-sm font-bold text-[#071713] disabled:opacity-40"
                    >
                        Devam
                    </button>
                </form>
            )}

            <div className="mt-4 flex items-center justify-center gap-4 text-xs text-white/40">
                <button type="button" onClick={() => answer('—')} className="hover:text-white/70">
                    Bu soruyu atla
                </button>
                <button
                    type="button"
                    onClick={() => onComplete(null)}
                    className="inline-flex items-center gap-1 hover:text-white/70"
                >
                    <SkipForward size={12} /> Anketi geç
                </button>
            </div>
        </>
    );
}
