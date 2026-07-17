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

    useEffect(() => {
        let ignore = false;
        async function start() {
            try {
                const res = await fetch(`${API}/api/v1/sessions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shareToken: token })
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
    }, [token]);

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
