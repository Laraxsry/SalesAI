import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ConnectionState, Track, RoomEvent } from 'livekit-client';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { CONFIG } from '../../config';
import { saveConversation } from '../../src/savedConversations';
import { getVisitorId } from '../../src/visitorIdentity';
import { CallControls } from '../../src/components/CallControls';
import { COLORS, FONT } from '../../src/theme';

/* global __DEV__ */

const liveKitNative = Platform.OS === 'web' ? {} : require('@livekit/react-native');
const { LiveKitRoom, VideoTrack, useTracks, useRoomContext, AudioSession, BarVisualizer, useVoiceAssistant } = liveKitNative;

const VOICE_STATE_LABEL = {
    connecting: 'Bağlanıyor…',
    'pre-connect-buffering': 'Bağlanıyor…',
    initializing: 'Hazırlanıyor…',
    idle: 'Hazır',
    listening: 'Dinliyor…',
    thinking: 'Düşünüyor…',
    speaking: 'Konuşuyor…',
    disconnected: 'Bağlantı kesildi',
    failed: 'Bağlantı başarısız',
};

function resolveLiveKitUrl(url) {
    const candidate = url || CONFIG.LIVEKIT_URL;
    if (Platform.OS !== 'web' && /^wss?:\/\/(localhost|127\.0\.0\.1)(?=[:/])/i.test(candidate)) {
        return CONFIG.LIVEKIT_URL;
    }
    return candidate;
}

export default function SessionRoute() {
    if (Platform.OS === 'web') return <WebSessionRedirect />;
    return <NativeSessionScreen />;
}

function WebSessionRedirect() {
    const { token } = useLocalSearchParams();
    const router = useRouter();
    const visitorBase = process.env.EXPO_PUBLIC_VISITOR_URL || (__DEV__ ? 'http://localhost:5174' : 'https://app.salesai.com');
    const destination = `${visitorBase}/v/${encodeURIComponent(token)}`;

    useEffect(() => {
        Linking.openURL(destination).catch(() => {});
    }, [destination]);

    return (
        <View style={styles.centerContainer}>
            <Text style={styles.loadingText}>Web görüşmesi açılıyor…</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => Linking.openURL(destination)}>
                <Text style={styles.retryText}>Görüşmeyi aç</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/')}>
                <Text style={styles.backText}>Ana ekrana dön</Text>
            </TouchableOpacity>
        </View>
    );
}

function NativeSessionScreen() {
    const { token } = useLocalSearchParams();
    const router = useRouter();

    const [connectionState, setConnectionState] = useState('idle'); // idle, permissions, fetching, connecting, connected, error
    const [errorMessage, setErrorMessage] = useState('');
    const [connDetails, setConnDetails] = useState(null);
    const [agentName, setAgentName] = useState('AI Temsilcisi');
    const endedRef = useRef(false);

    function debug(...args) {
        console.log('[mobile-session]', ...args);
    }

    // Prepares the native audio session (speaker/earpiece routing, category, playAndRecord) before joining.
    useEffect(() => {
        AudioSession.configureAudio({
            ios: { defaultOutput: 'speaker' }
        }).catch(() => {});
        if (Platform.OS === 'ios' && AudioSession.setAppleAudioConfiguration) {
            AudioSession.setAppleAudioConfiguration({
                audioCategory: 'playAndRecord',
                audioMode: 'voiceChat',
                audioCategoryOptions: ['defaultToSpeaker', 'allowBluetooth']
            }).catch(() => {});
        }
        AudioSession.startAudioSession().catch(() => {});
        return () => {
            AudioSession.stopAudioSession().catch(() => {});
        };
    }, []);

    // Request permissions and fetch connection details
    const startSession = async () => {
        try {
            endedRef.current = false;
            setConnectionState('permissions');
            if (Platform.OS === 'android') {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                    {
                        title: 'Mikrofon İzni',
                        message: 'Temsilciyle konuşabilmek için SalesAI mikrofon erişimine ihtiyaç duyar.',
                        buttonNeutral: 'Daha Sonra',
                        buttonNegative: 'Vazgeç',
                        buttonPositive: 'İzin Ver',
                    }
                );
                debug('android microphone permission result', granted);
                if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                    throw new Error('Temsilciyle konuşmak için mikrofon izni gereklidir.');
                }
            } else if (Platform.OS === 'ios') {
                // iOS permissions are handled natively by LiveKit / AVFoundation on audio track enable
            }

            setConnectionState('fetching');
            const visitorId = await Promise.race([
                getVisitorId().catch(() => null),
                new Promise((resolve) => setTimeout(() => resolve(null), 1500))
            ]);
            const res = await fetch(`${CONFIG.API_URL}/api/v1/sessions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Bypass-Tunnel-Reminder': 'true'
                },
                body: JSON.stringify({ shareToken: token, visitorName: 'Mobil Ziyaretçi', visitorId: visitorId || undefined }),
            });

            if (!res.ok) {
                throw new Error('Görüşme başlatılamadı. Bağlantı geçersiz veya süresi dolmuş olabilir.');
            }

            const data = await res.json();
            debug('session token fetched', {
                sessionId: data?.sessionId,
                roomName: data?.roomName,
                hasToken: Boolean(data?.token),
                avatarProvider: data?.avatarProvider
            });
            setConnDetails(data);
            setConnectionState('connecting');
        } catch (err) {
            console.error('Error starting session:', err);
            setErrorMessage(err instanceof TypeError ? 'SalesAI hizmetine ulaşılamıyor. Lütfen tekrar deneyin.' : err.message);
            setConnectionState('error');
        }
    };

    useEffect(() => {
        if (token) {
            startSession();
        }
    }, [token]);

    const handleDisconnect = () => {
        if (endedRef.current) return;
        endedRef.current = true;
        saveConversation({ token, agentName, sessionId: connDetails?.sessionId }).catch(() => {});
        if (connDetails?.sessionId && connDetails?.roomName) {
            // Public, roomName-verified endpoint (mirrors the web visitor app) —
            // marks the session ended and triggers post-call analysis/lead
            // extraction, same as VisitRoom.jsx does on the web side.
            fetch(`${CONFIG.API_URL}/api/v1/sessions/${connDetails.sessionId}/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName: connDetails.roomName })
            }).catch(() => {});
        }
        router.replace('/');
    };

    // Render loading/error states before LiveKit starts
    if (connectionState === 'permissions') {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={COLORS.lime} />
                <Text style={styles.loadingText}>Mikrofon izni isteniyor…</Text>
            </View>
        );
    }

    if (connectionState === 'fetching') {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={COLORS.lime} />
                <Text style={styles.loadingText}>Temsilciyle görüşme hazırlanıyor…</Text>
                <TouchableOpacity style={[styles.backButton, { marginTop: 24 }]} onPress={handleDisconnect}>
                    <Text style={styles.backText}>Vazgeç</Text>
                </TouchableOpacity>
            </View>
        );
    }

    if (connectionState === 'error') {
        return (
            <View style={styles.centerContainer}>
                <Text style={styles.errorHeader}>Bağlantı Kurulamadı</Text>
                <Text style={styles.errorDesc}>{errorMessage}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={startSession}>
                    <Text style={styles.retryText}>Tekrar Dene</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/')}>
                    <Text style={styles.backText}>Ana Ekrana Dön</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {connectionState === 'connecting' && (
                <View style={[StyleSheet.absoluteFill, styles.centerContainer, { zIndex: 10 }]}>
                    <ActivityIndicator size="large" color={COLORS.lime} />
                    <Text style={styles.loadingText}>Görüşmeye bağlanılıyor…</Text>
                    <TouchableOpacity style={[styles.backButton, { marginTop: 24 }]} onPress={handleDisconnect}>
                        <Text style={styles.backText}>Vazgeç</Text>
                    </TouchableOpacity>
                </View>
            )}

            {connDetails?.token && (
                <LiveKitRoom
                    serverUrl={resolveLiveKitUrl(connDetails?.livekitUrl)}
                    token={connDetails.token}
                    connect={true}
                    audio={true}
                    video={false}
                    options={{
                        publishDefaults: {
                            red: false,
                            audioSource: Track.Source.Microphone,
                        },
                    }}
                    onConnected={() => setConnectionState('connected')}
                    onDisconnected={handleDisconnect}
                    style={styles.roomContainer}
                >
                    <RoomView
                        setAgentName={setAgentName}
                    />
                </LiveKitRoom>
            )}
        </View>
    );
}

// Inner view — rendered inside <LiveKitRoom>, so useRoomContext() below returns
// the *actual* connected Room instance. (LiveKitRoom's onConnected callback
// takes no arguments — @livekit/react-native's LiveKitRoomProps.onConnected is
// `() => void` — so capturing "the room" via that callback, as this used to,
// silently produced `undefined` and made every control a no-op.)
function RoomView({ setAgentName }) {
    const room = useRoomContext();
    const { state: voiceState, audioTrack } = useVoiceAssistant();
    const [isMuted, setIsMuted] = useState(false);
    const [isSharingScreen, setIsSharingScreen] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [showShareConsent, setShowShareConsent] = useState(false);

    function debug(...args) {
        console.log('[mobile-room]', ...args);
    }

    function summarizeLocalAudioState(participant) {
        const pubs = Array.from(participant?.trackPublications?.values?.() || []);
        const audioPubs = pubs.filter((pub) => pub?.source === Track.Source.Microphone || pub?.kind === Track.Kind?.Audio);
        return {
            publicationCount: pubs.length,
            audioPublicationCount: audioPubs.length,
            audioPublications: audioPubs.map((pub) => ({
                sid: pub.trackSid,
                subscribed: pub.subscribed,
                muted: pub.isMuted,
                source: pub.source,
                hasTrack: Boolean(pub.track)
            }))
        };
    }

    // Guided tours arrive as remote screen-share tracks, separately from the
    // agent avatar camera. Keep local shares out of the main presentation.
    const cameraTracks = useTracks([Track.Source.Camera]);
    const screenTracks = useTracks([Track.Source.ScreenShare]);
    const remoteVideoTrack = cameraTracks.find((trackRef) => !trackRef.participant?.isLocal);
    const remoteScreenTrack = screenTracks.find((trackRef) => !trackRef.participant?.isLocal);
    const localScreenTrack = screenTracks.find((trackRef) => trackRef.participant?.isLocal);

    // Transcription + connection-lifecycle listeners, now on the real room.
    useEffect(() => {
        if (!room) return;

        debug('room context ready', {
            roomName: room.name,
            localIdentity: room.localParticipant?.identity
        });

        let microphoneActivationStarted = false;
        const activateMicrophone = async () => {
            if (microphoneActivationStarted || !room.localParticipant) return;
            microphoneActivationStarted = true;
            try {
                await AudioSession.startAudioSession();
                await AudioSession.setDefaultRemoteAudioTrackVolume(1);

                // On iOS an audio track created while AVAudioSession is still
                // activating can be published as unmuted but contain silence.
                // Recreate it once, after the room is fully connected.
                if (Platform.OS === 'ios') {
                    await room.localParticipant.setMicrophoneEnabled(false);
                }
                await room.localParticipant.setMicrophoneEnabled(true);
            } catch (err) {
                microphoneActivationStarted = false;
                console.warn('Failed to activate microphone:', err);
            } finally {
                debug('post-connect microphone activation attempted', summarizeLocalAudioState(room.localParticipant));
            }
        };

        room.on(RoomEvent.Connected, activateMicrophone);
        if (room.state === ConnectionState.Connected) activateMicrophone();

        const handleParticipantConnected = (participant) => {
            if (participant.identity.startsWith('agent_') || participant.identity.includes('worker')) {
                setAgentName(participant.name || 'AI Temsilcisi');
            }
        };
        room.on('participantConnected', handleParticipantConnected);
        room.remoteParticipants?.forEach?.(handleParticipantConnected);

        const onReconnecting = () => setReconnecting(true);
        const onReconnected = () => setReconnecting(false);
        room.on(RoomEvent.Reconnecting, onReconnecting);
        room.on(RoomEvent.Reconnected, onReconnected);

        const handleLocalTrackPublished = (publication) => {
            if (publication?.source === Track.Source.ScreenShare) setIsSharingScreen(true);
            debug('local track published', {
                source: publication?.source,
                kind: publication?.kind,
                sid: publication?.trackSid,
                hasTrack: Boolean(publication?.track)
            });
        };
        const handleLocalTrackUnpublished = (publication) => {
            if (publication?.source === Track.Source.ScreenShare) setIsSharingScreen(false);
            debug('local track unpublished', {
                source: publication?.source,
                kind: publication?.kind,
                sid: publication?.trackSid
            });
        };
        room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
        room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);

        // Agent-initiated stop: the agent-worker can't stop this device's own
        // screen share track, so it asks over the data channel instead.
        const handleData = (payload) => {
            let msg;
            try {
                msg = JSON.parse(new TextDecoder().decode(payload));
            } catch {
                return;
            }
            if (msg?.type === 'salesai:stop_screen_share' && room.localParticipant) {
                room.localParticipant.setScreenShareEnabled(false).catch(() => {});
                setIsSharingScreen(false);
            }
        };
        room.on(RoomEvent.DataReceived, handleData);

        return () => {
            room.off('participantConnected', handleParticipantConnected);
            room.off(RoomEvent.Connected, activateMicrophone);
            room.off(RoomEvent.Reconnecting, onReconnecting);
            room.off(RoomEvent.Reconnected, onReconnected);
            room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
            room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
            room.off(RoomEvent.DataReceived, handleData);
        };
    }, [room, setAgentName]);

    const toggleMute = async () => {
        if (!room?.localParticipant) {
            console.warn('toggleMute: room not ready yet');
            return;
        }
        const nextMuted = !isMuted;
        try {
            await room.localParticipant.setMicrophoneEnabled(!nextMuted);
            setIsMuted(nextMuted);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } catch (err) {
            // Simulators without a microphone input, or a denied mic permission,
            // reject here — surface it instead of leaving the button looking dead.
            console.warn('Failed to toggle microphone:', err?.message);
            Alert.alert('Mikrofon değiştirilemedi', err?.message || 'Bilinmeyen hata');
        }
    };

    const toggleScreenShare = async () => {
        if (!room?.localParticipant) {
            console.warn('toggleScreenShare: room not ready yet');
            return;
        }
        if (!isSharingScreen) {
            setShowShareConsent(true);
            return;
        }
        try {
            await room.localParticipant.setScreenShareEnabled(false);
            setIsSharingScreen(false);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } catch (err) {
            // Best-effort: screen share needs OS-level setup (ReplayKit / MediaProjection)
            // that isn't always available — fail gracefully instead of crashing the call.
            console.warn('Screen share unavailable on this device:', err?.message);
            Alert.alert('Ekran paylaşımı kullanılamıyor', 'Bu cihazda/derlemede ekran paylaşımı desteklenmiyor.');
        }
    };

    const confirmScreenShare = async () => {
        setShowShareConsent(false);
        if (!room?.localParticipant) return;
        try {
            await room.localParticipant.setScreenShareEnabled(true);
            setIsSharingScreen(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } catch (err) {
            console.warn('Screen share unavailable on this device:', err?.message);
            Alert.alert('Ekran paylaşımı kullanılamıyor', 'Bu cihazda/derlemede ekran paylaşımı desteklenmiyor.');
        }
    };

    const onEndPress = () => {
        room?.disconnect();
    };

    const stateLabel = reconnecting ? 'Yeniden bağlanıyor…' : (VOICE_STATE_LABEL[voiceState] || 'Hazır');

    return (
        <View style={styles.innerContainer}>
            <View style={styles.meetingHeader}>
                <Text style={styles.wordmark}>Sales<Text style={styles.wordmarkAccent}>AI</Text></Text>
                <View style={styles.statePill}>
                    <View style={[styles.statusDot, reconnecting && styles.statusDotWarn]} />
                    <Text style={styles.stateText}>{stateLabel}</Text>
                </View>
            </View>

            <View style={styles.stage}>
                {remoteScreenTrack ? (
                    <VideoTrack trackRef={remoteScreenTrack} objectFit="contain" style={styles.mainTrack} />
                ) : remoteVideoTrack ? (
                    <VideoTrack trackRef={remoteVideoTrack} objectFit="cover" style={styles.mainTrack} />
                ) : (
                    <View style={styles.voiceStage}>
                        <View style={styles.voiceOrb}>
                            <BarVisualizer
                                state={voiceState}
                                trackRef={audioTrack}
                                barCount={5}
                                options={{ minHeight: 0.18, maxHeight: 0.82, barColor: COLORS.lime, barWidth: 6, barBorderRadius: 8 }}
                                style={styles.barVisualizer}
                            />
                        </View>
                        <Text style={styles.voiceTitle}>AI temsilciniz</Text>
                        <Text style={styles.voiceStatus}>{stateLabel}</Text>
                    </View>
                )}

                {remoteScreenTrack && remoteVideoTrack && (
                    <View style={styles.pictureInPicture}>
                        <VideoTrack trackRef={remoteVideoTrack} objectFit="cover" style={styles.previewTrack} />
                    </View>
                )}

                {remoteScreenTrack && (
                    <View style={styles.remoteShareBadge}>
                        <Text style={styles.shareBadgeText}>AI size ürünü gösteriyor</Text>
                    </View>
                )}

                {isSharingScreen && localScreenTrack && (
                    <View style={styles.localPreview}>
                        <VideoTrack trackRef={localScreenTrack} objectFit="cover" style={styles.previewTrack} />
                    </View>
                )}

                {isSharingScreen && (
                    <View style={styles.localShareBadge}>
                        <Text style={styles.shareBadgeText}>Ekranınız görüşmeyle paylaşılıyor</Text>
                    </View>
                )}
            </View>

            {showShareConsent && (
                <View style={styles.shareConsentOverlay}>
                    <View style={styles.shareConsentCard}>
                        <Text style={styles.shareConsentTitle}>Ekranınızı paylaşmak istiyor musunuz?</Text>
                        <Text style={styles.shareConsentText}>
                            Seçtiğiniz ekran görüşmedeki AI tarafından analiz edilebilir. Paylaşımı istediğiniz an durdurabilirsiniz.
                        </Text>
                        <View style={styles.shareConsentActions}>
                            <TouchableOpacity style={styles.consentCancelButton} onPress={() => setShowShareConsent(false)}>
                                <Text style={styles.consentCancelText}>Vazgeç</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.consentShareButton} onPress={confirmScreenShare}>
                                <Text style={styles.consentShareText}>Paylaş</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}

            <View style={styles.controlsBar}>
                <CallControls
                    isMuted={isMuted}
                    toggleMute={toggleMute}
                    isSharingScreen={isSharingScreen}
                    toggleScreenShare={toggleScreenShare}
                    handleDisconnect={onEndPress}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.ink,
    },
    roomContainer: {
        flex: 1,
    },
    innerContainer: {
        flex: 1,
        backgroundColor: COLORS.ink,
    },
    centerContainer: {
        flex: 1,
        backgroundColor: COLORS.ink,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    loadingText: {
        color: 'rgba(255,255,255,0.6)',
        fontFamily: FONT.medium,
        fontSize: 15,
        marginTop: 16,
    },
    errorHeader: {
        color: '#FF9287',
        fontSize: 24,
        fontFamily: FONT.bold,
        marginBottom: 8,
    },
    errorDesc: {
        color: 'rgba(255,255,255,0.55)',
        fontFamily: FONT.regular,
        fontSize: 15,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
    },
    retryButton: {
        backgroundColor: COLORS.lime,
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 32,
        marginBottom: 12,
        width: '80%',
        alignItems: 'center',
    },
    retryText: {
        color: COLORS.ink,
        fontSize: 16,
        fontFamily: FONT.bold,
    },
    backButton: {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 32,
        width: '80%',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    backText: {
        color: 'rgba(255,255,255,0.62)',
        fontSize: 16,
        fontFamily: FONT.medium,
    },
    meetingHeader: {
        minHeight: Platform.OS === 'ios' ? 96 : 72,
        paddingTop: Platform.OS === 'ios' ? 46 : 18,
        paddingBottom: 14,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(7,23,19,0.98)',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
        zIndex: 5,
    },
    wordmark: {
        color: COLORS.white,
        fontFamily: FONT.bold,
        fontSize: 19,
        letterSpacing: -0.55,
    },
    wordmarkAccent: {
        color: COLORS.lime,
    },
    statePill: {
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.06)',
        paddingHorizontal: 12,
    },
    stage: {
        flex: 1,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#06120F',
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: COLORS.lime,
        marginRight: 8,
    },
    statusDotWarn: {
        backgroundColor: COLORS.amber,
    },
    stateText: {
        color: 'rgba(255,255,255,0.62)',
        fontFamily: FONT.bold,
        fontSize: 10.5,
    },
    mainTrack: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
        backgroundColor: '#020806',
    },
    voiceStage: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    voiceOrb: {
        width: 144,
        height: 144,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: 44,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: COLORS.inkSoft,
        shadowColor: COLORS.teal,
        shadowOffset: { width: 0, height: 24 },
        shadowOpacity: 0.24,
        shadowRadius: 40,
        elevation: 10,
    },
    barVisualizer: {
        width: 82,
        height: 64,
    },
    voiceTitle: {
        marginTop: 26,
        color: COLORS.white,
        fontFamily: FONT.bold,
        fontSize: 16,
    },
    voiceStatus: {
        marginTop: 6,
        color: 'rgba(255,255,255,0.42)',
        fontFamily: FONT.medium,
        fontSize: 11.5,
    },
    pictureInPicture: {
        position: 'absolute',
        right: 16,
        top: 16,
        width: 92,
        height: 132,
        overflow: 'hidden',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        backgroundColor: '#020806',
        elevation: 8,
    },
    localPreview: {
        position: 'absolute',
        right: 16,
        bottom: 16,
        width: 128,
        height: 82,
        overflow: 'hidden',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(215,249,91,0.65)',
        backgroundColor: '#020806',
        elevation: 8,
    },
    previewTrack: {
        width: '100%',
        height: '100%',
    },
    remoteShareBadge: {
        position: 'absolute',
        top: 16,
        left: 16,
        borderRadius: 12,
        backgroundColor: 'rgba(7,23,19,0.84)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    localShareBadge: {
        position: 'absolute',
        left: 16,
        top: 58,
        borderRadius: 12,
        backgroundColor: COLORS.tealDark,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    shareBadgeText: {
        color: COLORS.white,
        fontFamily: FONT.bold,
        fontSize: 10.5,
    },
    shareConsentOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 30,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 22,
        backgroundColor: 'rgba(0,0,0,0.72)',
    },
    shareConsentCard: {
        width: '100%',
        maxWidth: 380,
        borderRadius: 24,
        padding: 22,
        backgroundColor: COLORS.inkSoft,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        elevation: 18,
    },
    shareConsentTitle: {
        color: COLORS.white,
        fontFamily: FONT.bold,
        fontSize: 17,
        lineHeight: 23,
    },
    shareConsentText: {
        marginTop: 10,
        color: 'rgba(255,255,255,0.55)',
        fontFamily: FONT.regular,
        fontSize: 13.5,
        lineHeight: 20,
    },
    shareConsentActions: {
        marginTop: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
    },
    consentCancelButton: {
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 15,
        borderRadius: 13,
    },
    consentCancelText: {
        color: 'rgba(255,255,255,0.55)',
        fontFamily: FONT.medium,
        fontSize: 13.5,
    },
    consentShareButton: {
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 18,
        borderRadius: 13,
        backgroundColor: COLORS.lime,
    },
    consentShareText: {
        color: COLORS.ink,
        fontFamily: FONT.bold,
        fontSize: 13.5,
    },
    controlsBar: {
        paddingTop: 14,
        paddingBottom: Platform.OS === 'ios' ? 28 : 16,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(7,23,19,0.98)',
    },
});
