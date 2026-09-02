import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LiveKitRoom } from '@livekit/components-react';
import { Logo } from '@repo/ui';
import { Loader2, AlertCircle, PhoneOff, X } from 'lucide-react';
import { VisitRoom } from './VisitRoom.jsx';
import { PreCallSurvey } from './PreCallSurvey.jsx';
import { isValidEmbedSession, resolveEmbedParentOrigin } from './embedProtocol.js';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const READY_MESSAGE = 'salesai:embed:ready';
const SESSION_MESSAGE = 'salesai:embed:session';
const CLOSE_MESSAGE = 'salesai:embed:close';

/** Per-share-link visitor identity kept in localStorage — the last name typed
 * and a stable random key, so a reconnect to the same meeting is recognised as
 * the same person (Görev #11). All storage access is best-effort. */
function readVisitorStore(token) {
    try {
        const raw = localStorage.getItem(`salesai:v:${token}`);
        const parsed = raw ? JSON.parse(raw) : {};
        return { name: parsed.name || '', key: parsed.key || makeKey() };
    } catch {
        return { name: '', key: makeKey() };
    }
}
function writeVisitorStore(token, name, key) {
    try {
        localStorage.setItem(`salesai:v:${token}`, JSON.stringify({ name, key }));
    } catch {
        /* private mode / storage disabled — non-fatal */
    }
}
function makeKey() {
    try {
        return crypto.randomUUID();
    } catch {
        return `k_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    }
}

function CenteredMessage({ embed, icon: Icon, loading = false, onClose, children }) {
    return (
        <div className="visitor-stage relative flex h-full flex-col items-center justify-center overflow-hidden px-6 text-center">
            <div className="visitor-grid pointer-events-none absolute inset-0 opacity-50" />
            {embed && onClose && (
                <button type="button" onClick={onClose} aria-label="Widget'ı kapat" className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-white/60 hover:bg-white/10 hover:text-white">
                    <X size={17} aria-hidden="true" />
                </button>
            )}
            <div className="relative z-10 w-full max-w-sm rounded-[28px] border border-white/10 bg-white/[0.055] p-8 shadow-2xl shadow-black/20 backdrop-blur-xl">
                {!embed && (
                    <div className="mb-9 flex items-center justify-center gap-3">
                        <Logo className="[&_span]:text-white [&_span_span]:text-[#d7f95b]" />
                    </div>
                )}
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-[#d7f95b]">
                    <Icon size={23} className={loading ? 'animate-spin' : ''} />
                </span>
                <p className="mt-5 text-sm font-medium leading-6 text-white/60">{children}</p>
                {loading && <div className="mx-auto mt-6 h-1 w-24 overflow-hidden rounded-full bg-white/8"><div className="h-full w-1/2 animate-pulse rounded-full bg-[#d7f95b]" /></div>}
            </div>
        </div>
    );
}

export function Visit() {
    const { token } = useParams();
    const [searchParams] = useSearchParams();
    const embed = searchParams.get('embed') === '1';
    const embedParentOrigin = embed ? resolveEmbedParentOrigin(searchParams, document.referrer) : null;

    const [conn, setConn] = useState(null);
    const [embedConfig, setEmbedConfig] = useState(null);
    const [error, setError] = useState(null);
    const [ended, setEnded] = useState(false);

    const [debugAuth, setDebugAuth] = useState('');
    const [started, setStarted] = useState(false);
    const isDebug = searchParams.get('debug') === '1';
    // Every visitor gives a name before joining (Görev #11) — the agent uses
    // it to address people, and in a group session to say who asked what. The
    // embed widget takes its name from the host page (or leaves it blank).
    // A stable per-token key + the last name are kept in localStorage so a
    // reconnect to the same meeting is recognised as the same person.
    const stored = readVisitorStore(token);
    const [nameInput, setNameInput] = useState(stored.name || '');
    const [visitorName, setVisitorName] = useState(null);
    const visitorKeyRef = useRef(stored.key);
    const needsName = !embed && !isDebug && visitorName === null;
    // Görev #7 — pre-call survey: null = still checking, false = off, true = run it.
    const [surveyEnabled, setSurveyEnabled] = useState(embed || isDebug ? false : null);
    const [surveyDone, setSurveyDone] = useState(false);
    const planTokenRef = useRef(null);
    const needsSurvey =
        !embed && !isDebug && surveyEnabled === true && visitorName !== null && !surveyDone;
    // Guards against React 18 StrictMode's dev-only double effect invocation
    // (mount -> cleanup -> mount again). `ignore` below only prevents a stale
    // run from calling setConn — it does nothing to stop the POST /sessions
    // call itself from firing twice, which mints two real backend sessions +
    // LiveKit rooms + agent-worker dispatches for a single page load. Refs
    // survive StrictMode's simulated remount (same component instance), so
    // tracking "already started for this token" here makes the mint
    // idempotent per token while still re-minting if the token itself changes.
    const startedForTokenRef = useRef(null);

    // Görev #7 — check whether this link runs a pre-call survey.
    useEffect(() => {
        if (embed || isDebug) return;
        let cancelled = false;
        fetch(`${API}/api/v1/prejoin/${token}`)
            .then((r) => (r.ok ? r.json() : {}))
            .then((d) => {
                if (!cancelled) setSurveyEnabled(Boolean(d?.surveyEnabled));
            })
            .catch(() => {
                if (!cancelled) setSurveyEnabled(false);
            });
        return () => {
            cancelled = true;
        };
    }, [token, embed, isDebug]);

    useEffect(() => {
        if (embed) return;
        if (isDebug && !started) return;
        if (needsName) return; // wait for the name-entry screen
        if (surveyEnabled === null) return; // still checking for a survey
        if (needsSurvey) return; // wait for the questionnaire
        if (startedForTokenRef.current === token) return;
        startedForTokenRef.current = token;

        // No `ignore`/cleanup-based staleness guard here on purpose: the ref
        // check above already guarantees `start()` runs at most once per
        // token, so there is never a second overlapping fetch whose stale
        // response could need discarding. An `ignore` flag flipped by
        // StrictMode's dev-only simulated cleanup (mount -> cleanup ->
        // remount, same as the ref surviving it) would otherwise silently
        // swallow this single fetch's own response — `conn` never gets set,
        // and the page hangs on "AI temsilciye bağlanılıyor…" forever even
        // though the backend successfully minted the session.
        async function start() {
            try {
                let body = { shareToken: token };
                if (visitorName) body.visitorName = visitorName;
                if (visitorKeyRef.current) body.visitorKey = visitorKeyRef.current;
                if (planTokenRef.current) body.planToken = planTokenRef.current;
                if (isDebug && debugAuth) {
                    try {
                        body.transientAuth = JSON.parse(debugAuth);
                    } catch (e) {
                        setError('Geçersiz JSON formatı');
                        return;
                    }
                }

                const res = await fetch(`${API}/api/v1/sessions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || 'Bağlantı geçersiz veya artık aktif değil.');
                // conn: { sessionId, roomName, token, livekitUrl }
                setConn(data);
            } catch (err) {
                setError(err instanceof TypeError
                    ? 'SalesAI hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.'
                    : err.message);
            }
        }
        start();
    }, [token, embed, isDebug, started, debugAuth, needsName, visitorName, surveyEnabled, needsSurvey]);

    useEffect(() => {
        if (!embed) return;

        if (!embedParentOrigin) {
            setError('Widget yalnızca SalesAI SDK içinden açılabilir.');
            return;
        }

        function receiveSession(event) {
            if (event.source !== window.parent || event.origin !== embedParentOrigin) return;
            if (event.data?.type !== SESSION_MESSAGE) return;
            if (!isValidEmbedSession(event.data.session)) {
                setError('Widget oturum bilgisi geçersiz.');
                return;
            }
            setEmbedConfig(event.data.session.config || null);
            setConn(event.data.session);
        }

        window.addEventListener('message', receiveSession);
        window.parent.postMessage({ type: READY_MESSAGE }, embedParentOrigin);
        return () => window.removeEventListener('message', receiveSession);
    }, [embed, embedParentOrigin]);

    function closeEmbed() {
        if (!embed) return;
        if (embedParentOrigin) window.parent.postMessage({ type: CLOSE_MESSAGE }, embedParentOrigin);
    }

    if (isDebug && !started) {
        return (
            <div className="visitor-stage flex h-full flex-col items-center justify-center gap-4 px-6">
                <Logo />
                <p className="text-sm text-text-muted">Test için çerezlerinizi JSON olarak yapıştırın:</p>
                <textarea 
                    className="h-48 w-full max-w-lg rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-xs text-white outline-none focus:border-brand-light"
                    value={debugAuth}
                    onChange={(e) => setDebugAuth(e.target.value)}
                    placeholder='{"cookies": [{"name": "__Secure-1PSID", "value": "...", "domain": ".youtube.com", "path": "/", "secure": true}]}'
                />
                <button 
                    onClick={() => setStarted(true)}
                    className="rounded-xl bg-[#d7f95b] px-4 py-2.5 text-sm font-bold text-[#071713] hover:bg-[#c9ed45]"
                >
                    Çerezlerle Oturum Başlat
                </button>
            </div>
        );
    }


    if (needsName) {
        const submit = (e) => {
            e.preventDefault();
            const name = nameInput.trim() || 'Ziyaretçi';
            writeVisitorStore(token, name, visitorKeyRef.current);
            setVisitorName(name);
        };
        return (
            <div className="visitor-stage relative flex h-full flex-col items-center justify-center overflow-hidden px-6 text-center">
                <div className="visitor-grid pointer-events-none absolute inset-0 opacity-50" />
                <form
                    onSubmit={submit}
                    className="relative z-10 w-full max-w-sm rounded-[28px] border border-white/10 bg-white/[0.055] p-8 shadow-2xl shadow-black/20 backdrop-blur-xl"
                >
                    <div className="mb-7 flex items-center justify-center">
                        <Logo className="[&_span]:text-white [&_span_span]:text-[#d7f95b]" />
                    </div>
                    <p className="mb-4 text-sm font-medium leading-6 text-white/70">
                        Görüşmeye başlamadan önce, size nasıl hitap edelim?
                    </p>
                    <input
                        autoFocus
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        maxLength={60}
                        placeholder="Adınız"
                        className="mb-4 h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none focus:border-[#d7f95b]"
                    />
                    <button
                        type="submit"
                        className="w-full rounded-xl bg-[#d7f95b] px-4 py-2.5 text-sm font-bold text-[#071713] hover:bg-[#c9ed45]"
                    >
                        {surveyEnabled ? 'Devam' : 'Katıl'}
                    </button>
                </form>
            </div>
        );
    }

    if (needsSurvey) {
        return (
            <PreCallSurvey
                token={token}
                onComplete={(planToken) => {
                    planTokenRef.current = planToken || null;
                    setSurveyDone(true);
                }}
            />
        );
    }

    // Checked before `error`: ending the call can make an in-flight LiveKit
    // connect() reject with a "client initiated disconnect" error — once the
    // visitor has intentionally left, that trailing rejection is just noise.
    if (ended) {
        return (
            <CenteredMessage embed={embed} icon={PhoneOff} onClose={closeEmbed}>
                Görüşme sona erdi.
            </CenteredMessage>
        );
    }

    if (error) {
        return (
            <CenteredMessage embed={embed} icon={AlertCircle} onClose={closeEmbed}>
                {error}
            </CenteredMessage>
        );
    }

    if (!conn) {
        return (
            <CenteredMessage embed={embed} icon={Loader2} loading onClose={closeEmbed}>
                {embed ? 'Güvenli widget oturumu hazırlanıyor…' : 'AI temsilciye bağlanılıyor…'}
            </CenteredMessage>
        );
    }

    return (
        <div
            className="h-full"
            style={embedConfig?.theme?.primaryColor ? { '--color-brand': embedConfig.theme.primaryColor } : undefined}
        >
            <LiveKitRoom
                serverUrl={conn.livekitUrl}
                token={conn.token}
                connect
                audio={false}
                video={false}
                onDisconnected={() => setEnded(true)}
                onError={() => setError('Görüşme bağlantısında bir sorun oluştu. Lütfen tekrar deneyin.')}
                style={{ height: '100%' }}
            >
                <VisitRoom
                    embed={embed}
                    embedConfig={embedConfig}
                    sessionId={conn.sessionId}
                    roomName={conn.roomName}
                    maxParticipants={conn.maxParticipants}
                    onClose={closeEmbed}
                    onEnd={() => setEnded(true)}
                />
            </LiveKitRoom>
        </div>
    );
}
