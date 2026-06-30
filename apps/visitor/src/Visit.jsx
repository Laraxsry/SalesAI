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
        <LiveKitRoom
            serverUrl={conn.livekitUrl}
            token={conn.token}
            connect
            audio
            video={false}
            style={{ height: '100vh' }}
        >
            <VideoConference />
            <RoomAudioRenderer />
        </LiveKitRoom>
    );
}
