import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
    LiveKitRoom,
    RoomAudioRenderer,
    VideoConference
} from '@livekit/components-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export function Visit() {
    const { token } = useParams();
    const [conn, setConn] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let ignore = false;
        async function start() {
            try {
                const res = await fetch(`${API}/api/v1/sessions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shareToken: token })
                });
                if (!res.ok) throw new Error('Could not start session');
                const data = await res.json();
                if (!ignore) {
                    setConn(data);
                }
            } catch (err) {
                if (!ignore) {
                    setError(err.message);
                }
            }
        }
        start();
        return () => { ignore = true; };
    }, [token]);

    if (error) return <div style={{ padding: 32 }}>{error}</div>;
    if (!conn) return <div style={{ padding: 32 }}>Connecting to your AI rep…</div>;

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 16, background: '#111', color: '#fff', textAlign: 'center' }}>
                <h2>SalesAI Live Agent</h2>
                <p>Use the control bar below to mute/unmute or share your screen.</p>
            </div>
            
            <div style={{ flex: 1, position: 'relative' }}>
                <LiveKitRoom
                    serverUrl={conn.livekitUrl}
                    token={conn.token}
                    connect
                    audio
                    video={false}
                    style={{ height: '100%' }}
                >
                    <RoomAudioRenderer />
                    {/* The VideoConference component automatically handles showing screen shares (both from Agent and User) and Avatar videos, plus gives you a real control bar to share your screen. */}
                    <VideoConference />
                </LiveKitRoom>
            </div>
        </div>
    );
}

