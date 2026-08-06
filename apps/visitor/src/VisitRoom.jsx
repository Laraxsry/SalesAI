import { useEffect, useRef, useState } from 'react';
import {
    RoomAudioRenderer,
    VideoTrack,
    BarVisualizer,
    useVoiceAssistant,
    useLocalParticipant,
    useRoomContext,
    useTracks
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Logo } from '@repo/ui';
import { Mic, MicOff, PhoneOff, ScreenShare, ScreenShareOff, X } from 'lucide-react';

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
        <div aria-live="polite" aria-atomic="true" className="pointer-events-none absolute bottom-24 left-1/2 w-full max-w-lg -translate-x-1/2 px-4">
            <p className="rounded-[var(--radius-card)] bg-black/70 px-4 py-2.5 text-center text-sm text-white backdrop-blur">
                {last.text}
            </p>
        </div>
    );
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/** Rendered inside <LiveKitRoom>; everything here relies on LiveKit's room context. */
export function VisitRoom({ embed, embedConfig, sessionId, roomName, onClose, onEnd }) {
    const { state, audioTrack, videoTrack, agentTranscriptions } = useVoiceAssistant();
    const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant();
    // useVoiceAssistant only surfaces mic/camera; the guided-tour browser is
    // published as a screen-share track, so pick it up separately (remote only —
    // the visitor's own share must not be mirrored back to them).
    const screenTracks = useTracks([Track.Source.ScreenShare]);
    const tourTrack = screenTracks.find(t => !t.participant.isLocal);
    const localScreenTrack = screenTracks.find(t => t.participant.isLocal);
    const mainTrack = tourTrack ?? videoTrack;
    const room = useRoomContext();
    const [micError, setMicError] = useState(false);
    const [shareError, setShareError] = useState('');
    const [showShareConsent, setShowShareConsent] = useState(false);
    const startedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        if (embedConfig?.micAutoPrompt === false) return;
        localParticipant.setMicrophoneEnabled(true).catch(() => setMicError(true));
    }, [embedConfig?.micAutoPrompt, localParticipant]);

    function toggleMic() {
        localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => setMicError(true));
    }

    async function toggleScreenShare() {
        if (!isScreenShareEnabled) {
            setShowShareConsent(true);
            return;
        }
        try {
            await localParticipant.setScreenShareEnabled(false);
            setShareError('');
        } catch (err) {
            setShareError(err.message || 'Ekran paylaşımı durdurulamadı.');
        }
    }

    async function confirmScreenShare() {
        setShowShareConsent(false);
        setShareError('');
        try {
            await localParticipant.setScreenShareEnabled(true);
        } catch (err) {
            setShareError(err.message || 'Tarayıcı ekran paylaşımını başlatamadı.');
        }
    }

    async function endCall() {
        // Önce API'ye session'ın bittiğini bildir → analyze-session + lead extraction tetiklenir
        if (sessionId && roomName) {
            try {
                await fetch(`${API}/api/v1/sessions/${sessionId}/end`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roomName })
                });
            } catch {
                // Non-fatal — stale session cron job 5 dakika sonra temizler
            }
        }
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

            {embed && (
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Widget'ı kapat"
                    className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
                >
                    <X size={17} aria-hidden="true" />
                </button>
            )}

            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                {mainTrack ? (
                    <VideoTrack
                        trackRef={mainTrack}
                        className={`h-full w-full ${tourTrack ? 'object-contain' : 'object-cover'}`}
                    />
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

                {tourTrack && videoTrack && (
                    <div className="absolute right-4 top-4 h-28 w-20 overflow-hidden rounded-xl border border-white/20 bg-black shadow-xl sm:h-36 sm:w-28">
                        <VideoTrack trackRef={videoTrack} className="h-full w-full object-cover" />
                    </div>
                )}

                {tourTrack && (
                    <div className="absolute left-4 top-4 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur" role="status">
                        AI size ürünü gösteriyor
                    </div>
                )}

                {isScreenShareEnabled && localScreenTrack && (
                    <div className="absolute bottom-4 right-4 h-20 w-32 overflow-hidden rounded-lg border border-brand/60 bg-black shadow-lg">
                        <VideoTrack trackRef={localScreenTrack} className="h-full w-full object-cover" />
                    </div>
                )}

                {isScreenShareEnabled && (
                    <div className="absolute left-4 top-4 rounded-full bg-brand/90 px-3 py-1.5 text-xs font-medium text-white" role="status">
                        Ekranınız görüşmeyle paylaşılıyor
                    </div>
                )}

                {micError && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                        Mikrofon izni verilmedi — sesli konuşmak için tarayıcı izinlerini kontrol edin.
                    </div>
                )}

                {shareError && (
                    <div role="alert" className="absolute top-16 left-1/2 max-w-sm -translate-x-1/2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-950/90 px-3 py-2 text-center text-xs text-red-200">
                        {shareError}
                    </div>
                )}

                <Captions segments={agentTranscriptions} />
            </div>

            {showShareConsent && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-5">
                    <div role="dialog" aria-modal="true" aria-labelledby="share-consent-title" className="w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl">
                        <h2 id="share-consent-title" className="text-base font-semibold text-text">Ekranınızı paylaşmak istiyor musunuz?</h2>
                        <p className="mt-2 text-sm leading-6 text-text-muted">
                            Seçtiğiniz ekran görüşmedeki AI tarafından analiz edilebilir. Paylaşımı istediğiniz an durdurabilirsiniz; görüntüler varsayılan olarak saklanmaz.
                        </p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button type="button" onClick={() => setShowShareConsent(false)} className="rounded-[var(--radius-input)] px-3 py-2 text-sm text-text-muted hover:bg-surface-raised">Vazgeç</button>
                            <button type="button" onClick={confirmScreenShare} className="rounded-[var(--radius-input)] bg-brand px-3 py-2 text-sm font-medium text-white">Paylaş</button>
                        </div>
                    </div>
                </div>
            )}

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
