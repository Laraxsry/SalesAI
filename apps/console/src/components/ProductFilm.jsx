import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VoiceOrb } from '@repo/ui';
import {
    CalendarCheck,
    CircleCheck,
    Database,
    FileText,
    Globe,
    Link2,
    LoaderCircle,
    MousePointer2,
    Pause,
    Play,
    Plus,
    RotateCcw,
    Sparkles,
    TriangleAlert
} from 'lucide-react';

// The "video" is rendered live rather than shipped as a media file: it weighs
// a few KB, never buffers, stays sharp at any size and follows the page
// language. Scenes are laid out on a fixed 960x600 stage that is scaled to
// the frame width, so it behaves like a video player.
const STAGE_W = 960;
const STAGE_H = 600;
const SCENE_MS = 7000;
const SCENES = 5;
const TOTAL_MS = SCENE_MS * SCENES;
const TICK_MS = 50;

// The mock website used by the call and tour scenes, in stage coordinates.
const SITE = { left: 70, top: 112, width: 820, height: 396 };
const NAV_LEFT = [250, 350, 450, 572];
const PRICING_NAV = 2;

/** 0..1 progress of `p` inside the [from, to] window. */
function span(p, from, to) {
    return Math.min(1, Math.max(0, (p - from) / (to - from)));
}

function ease(x) {
    return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

function typed(text, progress) {
    return text.slice(0, Math.round(text.length * progress));
}

function speech(t) {
    const syllable = Math.max(0, Math.sin(t * 9.4)) ** 1.4;
    const phrase = 0.55 + 0.45 * Math.sin(t * 2.2 + Math.sin(t * 0.7) * 2);
    return Math.min(1, syllable * phrase * 0.9 + 0.05);
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    return `0:${String(seconds).padStart(2, '0')}`;
}

/** Cursor that glides between two stage points over [from, to]. */
function Cursor({ p, from, to, start, end, clickAt }) {
    const k = ease(span(p, from, to));
    const x = start[0] + (end[0] - start[0]) * k;
    const y = start[1] + (end[1] - start[1]) * k;
    const clicking = clickAt !== undefined && p > clickAt && p < clickAt + 0.08;
    return (
        <div className="pointer-events-none absolute z-30" style={{ left: x, top: y }}>
            <MousePointer2 size={26} className={`fill-white text-[#1e1b4b] drop-shadow-[0_4px_6px_rgba(0,0,0,0.35)] transition-transform ${clicking ? 'scale-90' : ''}`} />
            {clicking && <span className="film-ripple" />}
        </div>
    );
}

function StepCaption({ index, step }) {
    return (
        <div className="film-caption absolute inset-x-0 top-[26px] z-20 flex flex-col items-center text-center">
            <span className="flex items-center gap-2.5 rounded-full border border-white/15 bg-white/10 py-1.5 pl-1.5 pr-4 text-[15px] font-bold text-white backdrop-blur">
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] font-bold text-[#4c1d95]">{String(index + 1).padStart(2, '0')}</span>
                {step.title}
            </span>
            <span className="mt-2 text-[13px] font-medium text-white/65">{step.text}</span>
        </div>
    );
}

function ConnectScene({ p, copy }) {
    const urlProgress = span(p, 0.08, 0.3);
    const pressed = p > 0.36;
    const scanned = Math.round(span(p, 0.42, 0.9) * 24);
    return (
        <>
            <div className="film-pop is-on absolute left-[200px] top-[122px] w-[560px] rounded-[20px] bg-white p-6 text-[#1e1b4b] shadow-[0_30px_70px_-30px_rgba(15,10,60,0.9)]">
                <div className="flex items-center gap-2.5 text-[16px] font-bold">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f3ff] text-[#7c3aed]"><Globe size={16} /></span>
                    {copy.title}
                </div>
                <div className="mt-5 flex gap-2.5">
                    <div className="flex h-11 flex-1 items-center gap-2 rounded-xl border-2 border-[#ddd6fe] bg-[#faf9ff] px-3.5 text-[15px] font-medium">
                        <Link2 size={15} className="text-[#8b5cf6]" />
                        {urlProgress > 0 ? <span>{typed(copy.url, urlProgress)}</span> : <span className="text-[#a8a3c7]">{copy.placeholder}</span>}
                        {urlProgress > 0 && urlProgress < 1 && <span className="film-caret" />}
                    </div>
                    <span className={`flex h-11 items-center rounded-xl px-5 text-[14px] font-bold text-white transition-all ${pressed ? 'bg-[#6d28d9] shadow-[0_0_0_4px_rgba(167,139,250,0.45)]' : 'bg-[#7c3aed]'}`}>{copy.button}</span>
                </div>
                <div className={`film-pop mt-5 ${p > 0.4 ? 'is-on' : ''}`}>
                    <div className="flex items-center justify-between text-[13px] font-semibold text-[#6b6790]">
                        <span className="flex items-center gap-2">
                            {scanned < 24 ? <LoaderCircle size={14} className="film-spin text-[#8b5cf6]" /> : <CircleCheck size={14} className="text-[#16a34a]" />}
                            {copy.scanning}
                        </span>
                        <span className="font-mono">{scanned} / 24 {copy.pageCount}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#ede9fe]">
                        <span className="block h-full rounded-full bg-gradient-to-r from-[#a78bfa] to-[#f472b6]" style={{ width: `${(scanned / 24) * 100}%` }} />
                    </div>
                    <ul className="mt-4 grid grid-cols-2 gap-2">
                        {copy.pages.map(([name, path], index) => (
                            <li key={path} className={`film-pop flex items-center justify-between gap-2 rounded-xl border border-[#ece9fb] px-3 py-2.5 text-[13px] ${index === copy.pages.length - 1 ? 'col-span-2' : ''} ${p > 0.46 + index * 0.08 ? 'is-on' : ''}`}>
                                <span className="flex shrink-0 items-center gap-2 font-semibold"><FileText size={14} className="text-[#8b5cf6]" /> {name}</span>
                                <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-[#8b86ad]"><span className="truncate">{path}</span> <CircleCheck size={14} className="shrink-0 text-[#16a34a]" /></span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <Cursor p={p} from={0.24} to={0.34} start={[640, 470]} end={[712, 196]} clickAt={0.34} />
        </>
    );
}

function AnalyzeScene({ p, copy }) {
    const max = Math.max(...copy.topics.map(([, count]) => count));
    const total = copy.topics.reduce((sum, [, count]) => sum + count, 0);
    return (
        <>
            <div className="film-pop is-on absolute left-[80px] top-[122px] w-[410px] rounded-[20px] bg-white p-6 text-[#1e1b4b] shadow-[0_30px_70px_-30px_rgba(15,10,60,0.9)]">
                <div className="flex items-center gap-2.5 text-[16px] font-bold">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f3ff] text-[#7c3aed]"><Database size={16} /></span>
                    {copy.learned}
                </div>
                <ul className="mt-5 space-y-3.5">
                    {copy.topics.map(([name, count], index) => {
                        const grow = span(p, 0.06 + index * 0.08, 0.3 + index * 0.08);
                        return (
                            <li key={name} className={`film-pop ${p > 0.04 + index * 0.08 ? 'is-on' : ''}`}>
                                <div className="flex items-center justify-between text-[14px] font-semibold">
                                    <span>{name}</span>
                                    <span className="font-mono text-[12px] text-[#8b86ad]">{Math.round(count * grow)}</span>
                                </div>
                                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#ede9fe]">
                                    <span className="block h-full rounded-full bg-gradient-to-r from-[#a78bfa] to-[#f472b6]" style={{ width: `${(count / max) * 100 * grow}%` }} />
                                </div>
                            </li>
                        );
                    })}
                </ul>
                <div className={`film-pop mt-5 flex items-center gap-2.5 rounded-xl bg-[#ecfdf5] px-3.5 py-2.5 text-[14px] font-semibold text-[#166534] ${p > 0.66 ? 'is-on' : ''}`}>
                    <CircleCheck size={16} /> {copy.ready} · {total} {copy.facts}
                </div>
            </div>
            <div className={`film-pop absolute left-[514px] top-[122px] w-[370px] rounded-[20px] bg-white p-6 text-[#1e1b4b] shadow-[0_30px_70px_-30px_rgba(15,10,60,0.9)] ${p > 0.22 ? 'is-on' : ''}`}>
                <div className="flex items-center gap-2.5 text-[16px] font-bold">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fdf2f8] text-[#db2777]"><Sparkles size={16} /></span>
                    {copy.questions}
                </div>
                <ul className="mt-5 space-y-2.5">
                    {copy.questionList.map((question, index) => {
                        const from = 0.3 + index * 0.17;
                        const progress = span(p, from, from + 0.14);
                        return (
                            <li key={question} className={`film-pop min-h-[48px] rounded-xl border border-[#ece9fb] bg-[#faf9ff] px-4 py-3 text-[14px] font-medium leading-6 ${p > from - 0.02 ? 'is-on' : ''}`}>
                                {typed(question, progress)}
                                {progress > 0 && progress < 1 && <span className="film-caret" />}
                            </li>
                        );
                    })}
                </ul>
            </div>
        </>
    );
}

/** A generic customer website; `page` is 'home' or 'pricing'. */
function MockSite({ copy, page, activeNav, highlightPlan, children }) {
    return (
        <div className="film-pop is-on absolute overflow-hidden rounded-[18px] bg-white text-[#1e1b4b] shadow-[0_40px_90px_-40px_rgba(0,0,0,0.9)]" style={{ left: SITE.left, top: SITE.top, width: SITE.width, height: SITE.height }}>
            <div className="flex h-[34px] items-center gap-1.5 border-b border-[#ece9fb] bg-[#f7f6fd] px-4">
                <span className="h-2 w-2 rounded-full bg-[#fb7185]" /><span className="h-2 w-2 rounded-full bg-[#fbbf24]" /><span className="h-2 w-2 rounded-full bg-[#34d399]" />
                <span className="ml-4 flex h-5 items-center rounded-md bg-white px-3 font-mono text-[10px] text-[#8b86ad]">{copy.brand}{page === 'pricing' ? '/pricing' : ''}</span>
            </div>
            <div className="relative h-[52px] border-b border-[#f1effb]">
                <span className="absolute left-[28px] top-[16px] text-[15px] font-extrabold tracking-tight">{copy.brand}</span>
                {copy.nav.map((item, index) => (
                    <span key={item} className={`absolute top-[17px] text-[13px] font-semibold ${activeNav === index ? 'text-[#7c3aed]' : 'text-[#6b6790]'}`} style={{ left: NAV_LEFT[index] }}>
                        {item}
                    </span>
                ))}
                <span className="absolute right-[24px] top-[11px] rounded-lg bg-[#1e1b4b] px-3.5 py-2 text-[12px] font-bold text-white">{copy.cta}</span>
            </div>
            {page === 'home' ? (
                <div className="grid grid-cols-[1.1fr_1fr] gap-8 px-10 pt-10">
                    <div>
                        <p className="text-[28px] font-extrabold leading-tight tracking-tight">{copy.heroTitle}</p>
                        <p className="mt-3 text-[14px] font-medium leading-6 text-[#6b6790]">{copy.heroText}</p>
                        <span className="mt-5 inline-block rounded-lg bg-[#7c3aed] px-4 py-2.5 text-[13px] font-bold text-white">{copy.cta}</span>
                    </div>
                    <div className="h-[200px] rounded-2xl bg-gradient-to-br from-[#ede9fe] via-[#fae8ff] to-[#e0e7ff] p-4">
                        <div className="flex h-full items-end gap-2 rounded-xl bg-white/70 p-4">
                            {[40, 62, 50, 78, 66, 92, 74].map((height, index) => <span key={index} style={{ height: `${height}%` }} className="flex-1 rounded-t bg-[#a78bfa]" />)}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="film-scene px-[72px] pt-6">
                    <p className="text-center text-[22px] font-extrabold">{copy.pricingTitle}</p>
                    <div className="mt-5 grid grid-cols-3 gap-6">
                        {copy.plans.map(([name, users], index) => (
                            <div key={name} className={`relative rounded-2xl border p-5 transition-shadow ${index === 1 ? 'border-[#c4b5fd] bg-[#faf5ff]' : 'border-[#ece9fb] bg-white'} ${index === 1 && highlightPlan ? 'shadow-[0_0_0_4px_rgba(244,114,182,0.55)]' : ''}`}>
                                {index === 1 && <span className="absolute -top-2.5 left-5 rounded-full bg-[#7c3aed] px-2 py-0.5 text-[10px] font-bold text-white">{copy.popular}</span>}
                                <p className="text-[15px] font-bold">{name}</p>
                                <span className="mt-3 block h-6 rounded-md bg-[#ede9fe]" style={{ width: `${44 + index * 16}%` }} />
                                <p className="mt-1 text-[13px] font-semibold text-[#6b6790]">{users}</p>
                                <span className="mt-4 block h-1.5 w-3/4 rounded-full bg-[#ede9fe]" />
                                <span className="mt-2 block h-1.5 w-1/2 rounded-full bg-[#ede9fe]" />
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {children}
        </div>
    );
}

function CallScene({ p, copy, labels, playing }) {
    const opened = p > 0.24;
    const aiSpeaking = p > 0.62;
    return (
        <>
            <MockSite copy={copy} page="home" activeNav={0}>
                {!opened && (
                    <span className="film-launcher absolute bottom-[22px] right-[24px] flex items-center gap-2 rounded-full bg-[#1e1b4b] py-1.5 pl-1.5 pr-4 text-[13px] font-bold text-white shadow-xl">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#f472b6] to-[#6366f1]"><Sparkles size={13} /></span>
                        {copy.launcher}
                    </span>
                )}
                {opened && (
                    <div className="film-panel absolute bottom-[16px] right-[16px] flex h-[340px] w-[300px] flex-col overflow-hidden rounded-[20px] bg-[#0f0a2e] text-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-[13px] font-bold">
                            {copy.panelTitle}
                            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#f9a8d4]"><span className="h-1.5 w-1.5 rounded-full bg-[#f472b6]" /> {labels.live}</span>
                        </div>
                        <div className="relative mx-auto mt-2 flex h-[116px] w-[116px] items-center justify-center">
                            <span className="film-spark" aria-hidden="true" />
                            <div className="film-bloom">
                                <VoiceOrb size={116} mode={!playing ? 'idle' : aiSpeaking ? 'speaking' : 'listening'} getLevel={() => speech(performance.now() / 1000) * (aiSpeaking ? 1 : 0.5)} label={labels.orb} />
                            </div>
                        </div>
                        <div className="mt-2 space-y-2 px-3.5">
                            <div className={`film-pop max-w-[86%] rounded-2xl rounded-bl-md bg-white/10 px-3 py-2 text-[12.5px] font-medium leading-5 text-white/90 ${p > 0.38 ? 'is-on' : ''}`}>
                                {copy.visitorLine}
                            </div>
                            <div className={`film-pop ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-gradient-to-r from-[#f472b6] to-[#a78bfa] px-3 py-2 text-[12.5px] font-semibold leading-5 text-[#1e1b4b] ${p > 0.62 ? 'is-on' : ''}`}>
                                {copy.aiLine}
                            </div>
                        </div>
                    </div>
                )}
            </MockSite>
            <Cursor p={p} from={0.06} to={0.2} start={[520, 420]} end={[SITE.left + SITE.width - 110, SITE.top + SITE.height - 46]} clickAt={0.2} />
        </>
    );
}

function TourScene({ p, copy, labels, playing }) {
    const onPricing = p > 0.36;
    const navX = SITE.left + NAV_LEFT[PRICING_NAV] + 30;
    const navY = SITE.top + 34 + 22;
    const planX = SITE.left + 72 + 220 + 24 + 110;
    const planY = SITE.top + 250;
    const toPlan = p > 0.4;
    return (
        <>
            <MockSite copy={copy} page={onPricing ? 'pricing' : 'home'} activeNav={onPricing ? PRICING_NAV : 0} highlightPlan={p > 0.56}>
                <div className="film-pop is-on absolute bottom-[16px] right-[16px] flex max-w-[330px] items-center gap-2.5 rounded-full bg-[#0f0a2e] py-1.5 pl-1.5 pr-4 text-[12.5px] font-semibold text-white shadow-2xl">
                    <VoiceOrb size={40} mode={playing ? 'speaking' : 'idle'} getLevel={() => speech(performance.now() / 1000 + 2)} label={labels.orb} />
                    {p > 0.56 ? copy.tourCaption : '…'}
                </div>
            </MockSite>
            {toPlan ? (
                <Cursor p={p} from={0.42} to={0.56} start={[navX, navY]} end={[planX, planY]} />
            ) : (
                <Cursor p={p} from={0.06} to={0.3} start={[480, 430]} end={[navX, navY]} clickAt={0.32} />
            )}
        </>
    );
}

function ResultScene({ p, copy }) {
    const intent = Math.round(span(p, 0.08, 0.4) * 86);
    return (
        <>
            <div className="film-pop is-on absolute left-[70px] top-[122px] w-[420px] rounded-[20px] bg-white p-6 text-[#1e1b4b] shadow-[0_30px_70px_-30px_rgba(15,10,60,0.9)]">
                <div className="flex items-center justify-between">
                    <p className="text-[17px] font-bold">{copy.title}</p>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f3ff] text-[#7c3aed]"><Sparkles size={16} /></span>
                </div>
                <div className="mt-5">
                    <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span className="text-[#6b6790]">{copy.intent}</span>
                        <span className="text-[#be185d]">{copy.intentValue} · {intent}%</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#ede9fe]">
                        <span className="block h-full rounded-full bg-gradient-to-r from-[#a78bfa] to-[#f472b6]" style={{ width: `${intent}%` }} />
                    </div>
                </div>
                <div className="mt-5 space-y-2.5">
                    {copy.fields.map(([label, value], index) => (
                        <div key={label} className={`film-pop flex items-center justify-between rounded-xl border border-[#ece9fb] px-4 py-3 text-[14px] ${p > 0.18 + index * 0.08 ? 'is-on' : ''}`}>
                            <span className="font-medium text-[#6b6790]">{label}</span>
                            <span className="font-bold">{value}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className={`film-pop absolute left-[514px] top-[122px] w-[376px] rounded-[20px] bg-white p-6 text-[#1e1b4b] shadow-[0_30px_70px_-30px_rgba(15,10,60,0.9)] ${p > 0.3 ? 'is-on' : ''}`}>
                <p className="text-[15px] font-bold">{copy.asked}</p>
                <ul className="mt-4 space-y-2">
                    {copy.askedList.map((question, index) => {
                        const gap = index === copy.askedList.length - 1;
                        return (
                            <li key={question} className={`film-pop flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium ${gap ? 'border-[#fde68a] bg-[#fffbeb]' : 'border-[#ece9fb]'} ${p > 0.36 + index * 0.08 ? 'is-on' : ''}`}>
                                <span>{question}</span>
                                {gap ? (
                                    <TriangleAlert size={15} className="shrink-0 text-[#d97706]" />
                                ) : (
                                    <span className="shrink-0 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-bold text-[#16a34a]">{copy.answered}</span>
                                )}
                            </li>
                        );
                    })}
                </ul>
                <div className={`film-pop mt-4 rounded-xl bg-[#fffbeb] p-3.5 ${p > 0.6 ? 'is-on' : ''}`}>
                    <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[#b45309]"><TriangleAlert size={13} /> {copy.gap}</p>
                    <p className="mt-1.5 text-[13px] font-medium text-[#78350f]">{copy.gapText}</p>
                    <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[#1e1b4b] px-3 py-1.5 text-[12px] font-bold text-white"><Plus size={13} /> {copy.gapAction}</span>
                </div>
            </div>
            <div className={`film-pop absolute bottom-[86px] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-[#1e1b4b] shadow-xl ${p > 0.74 ? 'is-on' : ''}`}>
                <CalendarCheck size={16} className="text-[#7c3aed]" /> {copy.saved}
            </div>
        </>
    );
}

/** Autoplaying product walkthrough, styled as a video player. */
export function ProductFilm() {
    const { t } = useTranslation();
    const film = t('landing.film', { returnObjects: true });
    const labels = { orb: t('landing.call.orbLabel'), live: t('landing.call.liveBadge') };

    const frameRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [elapsed, setElapsed] = useState(0);
    const [userPaused, setUserPaused] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    const [inView, setInView] = useState(false);
    const playing = !userPaused && inView;

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return undefined;
        const resize = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / STAGE_W));
        resize.observe(frame);
        const visibility = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
        visibility.observe(frame);
        return () => {
            resize.disconnect();
            visibility.disconnect();
        };
    }, []);

    useEffect(() => {
        if (!playing) return undefined;
        const timer = setInterval(() => setElapsed((value) => (value + TICK_MS) % TOTAL_MS), TICK_MS);
        return () => clearInterval(timer);
    }, [playing]);

    const scene = Math.floor(elapsed / SCENE_MS);
    const p = (elapsed % SCENE_MS) / SCENE_MS;
    const sceneProps = { p, labels, playing };

    return (
        <div className="film-shell relative mx-auto w-full max-w-[1100px] rounded-[28px] border border-white/12 bg-white/[0.03] p-2 shadow-[0_60px_140px_-55px_rgba(0,0,0,0.95)] sm:p-3">
            <div
                ref={frameRef}
                role="region"
                aria-label={film.label}
                className="film-frame relative overflow-hidden rounded-[22px]"
                style={{ height: STAGE_H * scale }}
                data-paused={!playing || undefined}
            >
                <div className="film-bg absolute inset-0" aria-hidden="true" />
                <div className="absolute left-0 top-0 origin-top-left" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
                    <div key={scene} className="film-scene absolute inset-0">
                        <StepCaption index={scene} step={film.steps[scene]} />
                        {scene === 0 && <ConnectScene p={p} copy={film.connect} />}
                        {scene === 1 && <AnalyzeScene p={p} copy={film.analyze} />}
                        {scene === 2 && <CallScene {...sceneProps} copy={film.site} />}
                        {scene === 3 && <TourScene {...sceneProps} copy={film.site} />}
                        {scene === 4 && <ResultScene p={p} copy={film.result} />}
                    </div>
                </div>

                <div className="film-controls absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 pb-3 pt-10 sm:gap-4 sm:px-5 sm:pb-4">
                    <button
                        type="button"
                        onClick={() => setUserPaused((value) => !value)}
                        aria-label={playing ? film.pause : film.play}
                        title={playing ? film.pause : film.play}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#1e1b4b] transition-transform hover:scale-105"
                    >
                        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
                    </button>
                    <div className="grid flex-1 grid-cols-5 gap-1.5 sm:gap-2">
                        {film.chapters.map((chapter, index) => {
                            const fill = index < scene ? 1 : index === scene ? p : 0;
                            return (
                                <button key={chapter} type="button" onClick={() => setElapsed(index * SCENE_MS)} className="group text-left" aria-label={chapter}>
                                    <span className="block h-1 overflow-hidden rounded-full bg-white/25">
                                        <span className="block h-full rounded-full bg-white" style={{ width: `${fill * 100}%` }} />
                                    </span>
                                    <span className={`mt-1.5 hidden text-[11px] font-semibold transition-colors sm:block ${index === scene ? 'text-white' : 'text-white/50 group-hover:text-white/80'}`}>{chapter}</span>
                                </button>
                            );
                        })}
                    </div>
                    <span className="hidden shrink-0 font-mono text-[11px] font-semibold text-white/60 sm:block">{formatTime(elapsed)} / {formatTime(TOTAL_MS)}</span>
                    <button
                        type="button"
                        onClick={() => {
                            setElapsed(0);
                            setUserPaused(false);
                        }}
                        aria-label={film.replay}
                        title={film.replay}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        <RotateCcw size={15} />
                    </button>
                </div>
            </div>
        </div>
    );
}
