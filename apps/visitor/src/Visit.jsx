import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
    LiveKitRoom,
    RoomAudioRenderer,
    VideoConference
} from '@livekit/components-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/**
 * Public visitor experience. Opening /v/:token creates a session, joins the
 * LiveKit room, and renders the agent (avatar video + audio). The agent-worker
 * joins the same room to drive voice, avatar, and screen share.
 */
export function Visit() {
    const { token } = useParams();
    const [conn, setConn] = useState(null);
    const [error, setError] = useState(null);
    const [layoutMode, setLayoutMode] = useState('avatar-only'); // 'avatar-only' | 'tour' | 'customer-share'

    async function start() {
        try {
            const res = await fetch(`${API}/api/v1/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shareToken: token })
            });
            if (!res.ok) throw new Error('Could not start session');
            setConn(await res.json());
        } catch (err) {
            setError(err.message);
        }
    }

    useEffect(() => {
        // auto-start on mount
        start();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    if (error) return <div style={{ padding: 32 }}>{error}</div>;
    if (!conn) return <div style={{ padding: 32 }}>Connecting to your AI rep…</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            {/* Header / Controls */}
            <header style={{ padding: 16, background: '#f0f0f0', display: 'flex', gap: 16 }}>
                <button onClick={() => setLayoutMode('avatar-only')}>Avatar Only</button>
                <button onClick={() => setLayoutMode('tour')}>Request Demo (Tour)</button>
                <button onClick={() => setLayoutMode('customer-share')}>Share My Screen</button>
                {layoutMode === 'customer-share' && <span style={{ color: 'red' }}>Agent is viewing your screen</span>}
            </header>

            <div style={{ flex: 1, display: 'flex' }}>
                {layoutMode === 'tour' && (
                    <div style={{ flex: 1, background: '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <h1>Guided Tour Video</h1>
                    </div>
                )}
                {layoutMode === 'customer-share' && (
                    <div style={{ flex: 1, background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <h1>Your Screen Share</h1>
                    </div>
                )}
                
                {/* LiveKit Room (Avatar) */}
                <div style={{ flex: layoutMode === 'avatar-only' ? 1 : '0 0 300px' }}>
                    <LiveKitRoom
                        serverUrl={conn.livekitUrl}
                        token={conn.token}
                        connect
                        audio
                        video={false}
                        style={{ height: '100%' }}
                    >
                        <VideoConference />
                        <RoomAudioRenderer />
                    </LiveKitRoom>
                </div>
            </div>
        </div>
    );
}
