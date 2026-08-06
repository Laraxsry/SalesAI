import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LiveKitRoom } from '@livekit/components-react';
import { Logo } from '@repo/ui';
import { Loader2, AlertCircle, PhoneOff, X } from 'lucide-react';
import { VisitRoom } from './VisitRoom.jsx';
import { isValidEmbedSession, resolveEmbedParentOrigin } from './embedProtocol.js';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const READY_MESSAGE = 'salesai:embed:ready';
const SESSION_MESSAGE = 'salesai:embed:session';
const CLOSE_MESSAGE = 'salesai:embed:close';

function CenteredMessage({ embed, icon: Icon, loading = false, onClose, children }) {
    return (
        <div className="relative flex h-full flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
            {embed && onClose && (
                <button type="button" onClick={onClose} aria-label="Widget'ı kapat" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised text-text-muted hover:text-text">
                    <X size={17} aria-hidden="true" />
                </button>
            )}
            {!embed && <Logo />}
            <Icon size={28} className={`text-text-muted ${loading ? 'animate-spin' : ''}`} />
            <p className="text-sm text-text-muted">{children}</p>
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

    useEffect(() => {
        if (embed) return;
        if (isDebug && !started) return;

        let ignore = false;
        async function start() {
            try {
                let body = { shareToken: token };
                if (isDebug && debugAuth) {
                    try {
                        body.transientAuth = JSON.parse(debugAuth);
                    } catch (e) {
                        if (!ignore) setError('Geçersiz JSON formatı');
                        return;
                    }
                }

                const res = await fetch(`${API}/api/v1/sessions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Bağlantı kurulamadı');
                // conn: { sessionId, roomName, token, livekitUrl }
                if (!ignore) setConn(data);
            } catch (err) {
                if (!ignore) {
                    setError(err instanceof TypeError
                        ? 'SalesAI hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.'
                        : err.message);
                }
            }
        }
        start();
        return () => {
            ignore = true;
        };
    }, [token, embed, isDebug, started, debugAuth]);

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
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg px-6">
                <Logo />
                <p className="text-sm text-text-muted">Test için çerezlerinizi JSON olarak yapıştırın:</p>
                <textarea 
                    className="w-full max-w-lg h-48 p-2 text-xs bg-bg-muted border border-border rounded"
                    value={debugAuth}
                    onChange={(e) => setDebugAuth(e.target.value)}
                    placeholder='{"cookies": [{"name": "__Secure-1PSID", "value": "...", "domain": ".youtube.com", "path": "/", "secure": true}]}'
                />
                <button 
                    onClick={() => setStarted(true)}
                    className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-primary-hover"
                >
                    Çerezlerle Oturum Başlat
                </button>
            </div>
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
                    onClose={closeEmbed}
                    onEnd={() => setEnded(true)}
                />
            </LiveKitRoom>
        </div>
    );
}
