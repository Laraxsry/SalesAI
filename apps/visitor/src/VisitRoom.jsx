import { useEffect, useRef, useState } from 'react';
import {
    RoomAudioRenderer,
    VideoTrack,
    BarVisualizer,
    useVoiceAssistant,
    useLocalParticipant,
    useRoomContext
} from '@livekit/components-react';
import { Logo } from '@repo/ui';
import { Mic, MicOff, PhoneOff, ScreenShare, ScreenShareOff } from 'lucide-react';

const STATE_LABEL = {
    connecting: 'Bağlanıyor…',
    'pre-connect-buffering': 'Bağlanıyor…',
    initializing: 'Hazırlanıyor…',
    idle: 'Hazır',
    listening: 'Dinliyor…',
    thinking: 'Düşünüyor…',
    speaking: 'Konuşuyor…',
    disconnected: 'Bağlantı kesildi',
    failed: 'Bağlantı başarısız'
};

function Captions({ segments }) {
    const last = segments[segments.length - 1];
    if (!last?.text) return null;
    return (
        <div className="pointer-events-none absolute bottom-24 left-1/2 w-full max-w-lg -translate-x-1/2 px-4">
            <p className="rounded-[var(--radius-card)] bg-black/70 px-4 py-2.5 text-center text-sm text-white backdrop-blur">
                {last.text}
            </p>
        </div>
    );
}

/** Rendered inside <LiveKitRoom>; everything here relies on LiveKit's room context. */
export function VisitRoom({ embed, onEnd }) {
    const { state, audioTrack, videoTrack, agentTranscriptions } = useVoiceAssistant();
    const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant();
    const room = useRoomContext();
    const [micError, setMicError] = useState(false);
    const startedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        localParticipant.setMicrophoneEnabled(true).catch(() => setMicError(true));
    }, [localParticipant]);

    function toggleMic() {
        localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => setMicError(true));
    }

    function toggleScreenShare() {
        localParticipant.setScreenShareEnabled(!isScreenShareEnabled).catch(() => {});
    }

    function endCall() {
        room.disconnect();
        onEnd();
    }

    return (
        <div className="relative flex h-full flex-col bg-bg">
            <RoomAudioRenderer />

            {!embed && (
                <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
                    <Logo />
                    <span className="text-xs text-text-muted">{STATE_LABEL[state] ?? state}</span>
                </div>
            )}

            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                {videoTrack ? (
                    <VideoTrack trackRef={videoTrack} className="h-full w-full object-cover" />
                ) : (
                    <div className="flex flex-col items-center gap-6">
                        <div className="flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-brand-light to-brand-dark shadow-[0_0_60px_-10px_rgba(109,94,252,0.6)]">
                            <BarVisualizer
                                state={state}
                                trackRef={audioTrack}
                                barCount={5}
                                options={{ minHeight: 20, maxHeight: 70 }}
                                className="h-16 w-20"
                            />
                        </div>
                        {embed && <p className="text-sm text-text-muted">{STATE_LABEL[state] ?? state}</p>}
                    </div>
                )}

                {micError && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                        Mikrofon izni verilmedi — sesli konuşmak için tarayıcı izinlerini kontrol edin.
                    </div>
                )}

                <Captions segments={agentTranscriptions} />
            </div>

            <div className="flex items-center justify-center gap-3 border-t border-border bg-surface px-6 py-4">
                <button
                    onClick={toggleMic}
                    title={isMicrophoneEnabled ? 'Mikrofonu kapat' : 'Mikrofonu aç'}
                    className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                        isMicrophoneEnabled ? 'bg-surface-raised text-text hover:bg-bg' : 'bg-red-500/15 text-red-400'
                    }`}
                >
                    {isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
                </button>

                <button
                    onClick={toggleScreenShare}
                    title={isScreenShareEnabled ? 'Ekran paylaşımını durdur' : 'Ekranımı paylaş'}
                    className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                        isScreenShareEnabled ? 'bg-brand/20 text-brand-light' : 'bg-surface-raised text-text hover:bg-bg'
                    }`}
                >
                    {isScreenShareEnabled ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
                </button>

                <button
                    onClick={endCall}
                    title="Görüşmeyi sonlandır"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
                >
                    <PhoneOff size={18} />
                </button>
            </div>
        </div>
    );
}
