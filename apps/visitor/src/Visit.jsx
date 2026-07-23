import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LiveKitRoom } from '@livekit/components-react';
import { Logo } from '@repo/ui';
import { Loader2, AlertCircle, PhoneOff } from 'lucide-react';
import { VisitRoom } from './VisitRoom.jsx';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';

function CenteredMessage({ embed, icon: Icon, children }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
            {!embed && <Logo />}
            <Icon size={28} className="text-text-muted" />
            <p className="text-sm text-text-muted">{children}</p>
        </div>
    );
}

export function Visit() {
    const { token } = useParams();
    const [searchParams] = useSearchParams();
    const embed = searchParams.get('embed') === '1';

    const [conn, setConn] = useState(null);
    const [error, setError] = useState(null);
    const [ended, setEnded] = useState(false);

    const [debugAuth, setDebugAuth] = useState('');
    const [started, setStarted] = useState(false);
    const isDebug = searchParams.get('debug') === '1';

    useEffect(() => {
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
                if (!ignore) setConn(data);
            } catch (err) {
                if (!ignore) setError(err.message);
            }
        }
        start();
        return () => {
            ignore = true;
        };
    }, [token, isDebug, started, debugAuth]);

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
            <CenteredMessage embed={embed} icon={PhoneOff}>
                Görüşme sona erdi.
            </CenteredMessage>
        );
    }

    if (error) {
        return (
            <CenteredMessage embed={embed} icon={AlertCircle}>
                {error}
            </CenteredMessage>
        );
    }

    if (!conn) {
        return (
            <CenteredMessage embed={embed} icon={Loader2}>
                AI temsilciye bağlanılıyor…
            </CenteredMessage>
        );
    }

    return (
        <LiveKitRoom
            serverUrl={conn.livekitUrl}
            token={conn.token}
            connect
            audio={false}
            video={false}
            onDisconnected={() => setEnded(true)}
            onError={(err) => setError(err.message)}
            style={{ height: '100%' }}
        >
            <VisitRoom embed={embed} onEnd={() => setEnded(true)} />
        </LiveKitRoom>
    );
}
