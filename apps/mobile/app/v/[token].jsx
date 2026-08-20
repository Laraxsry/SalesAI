import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, PermissionsAndroid, Alert, Linking, TextInput, KeyboardAvoidingView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ConnectionState, Track, RoomEvent } from 'livekit-client';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { CONFIG } from '../../config';
import { saveConversation } from '../../src/savedConversations';
import { getVisitorId } from '../../src/visitorIdentity';
import { CallControls } from '../../src/components/CallControls';

/* global __DEV__ */

const liveKitNative = Platform.OS === 'web' ? {} : require('@livekit/react-native');
const { LiveKitRoom, VideoTrack, useTracks, useRoomContext, AudioSession } = liveKitNative;
const AvatarView = Platform.OS === 'web' ? null : require('../../src/components/AvatarView').AvatarView;

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
                <ActivityIndicator size="large" color="#6d5efc" />
                <Text style={styles.loadingText}>Mikrofon izni isteniyor…</Text>
            </View>
        );
    }

    if (connectionState === 'fetching') {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#6d5efc" />
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
                    <ActivityIndicator size="large" color="#6d5efc" />
                    <Text style={styles.loadingText}>Görüşmeye bağlanılıyor…</Text>
                    <TouchableOpacity style={[styles.backButton, { marginTop: 24 }]} onPress={handleDisconnect}>
                        <Text style={styles.backText}>Vazgeç</Text>
                    </TouchableOpacity>
                </View>
            )}

            {connDetails?.token && (
                <LiveKitRoom
                    serverUrl={connDetails?.livekitUrl || CONFIG.LIVEKIT_URL}
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
                        agentName={agentName}
                        setAgentName={setAgentName}
                        avatarProvider={connDetails.avatarProvider}
                        handleDisconnect={handleDisconnect}
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
function RoomView({ agentName, setAgentName, avatarProvider, handleDisconnect }) {
    const room = useRoomContext();
    const [isMuted, setIsMuted] = useState(false);
    const [isSharingScreen, setIsSharingScreen] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [isDeafened, setIsDeafened] = useState(false);
    const [chatInput, setChatInput] = useState('');

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

    const sendChatMessage = async () => {
        if (!chatInput.trim() || !room?.localParticipant) return;
        const text = chatInput.trim();
        setChatInput('');
        try {
            const payload = new TextEncoder().encode(JSON.stringify({ type: 'chat', text }));
            await room.localParticipant.publishData(payload, { reliable: true });
            if (typeof room.localParticipant.sendChatMessage === 'function') {
                await room.localParticipant.sendChatMessage(text).catch(() => {});
            }
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } catch (e) {
            console.warn('Failed to send text message:', e);
        }
    };

    // Guided tours arrive as remote screen-share tracks, separately from the
    // agent avatar camera. Keep local shares out of the main presentation.
    const cameraTracks = useTracks([Track.Source.Camera]);
    const screenTracks = useTracks([Track.Source.ScreenShare]);
    const remoteVideoTrack = cameraTracks.find((trackRef) => !trackRef.participant?.isLocal);
    const remoteScreenTrack = screenTracks.find((trackRef) => !trackRef.participant?.isLocal);
    const localScreenTrack = screenTracks.find((trackRef) => trackRef.participant?.isLocal);
    const primaryScreenTrack = remoteScreenTrack || localScreenTrack;
    const isPresentingScreen = Boolean(primaryScreenTrack);
    const hasVideo = Boolean(remoteVideoTrack);

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
            debug('local track published', {
                source: publication?.source,
                kind: publication?.kind,
                sid: publication?.trackSid,
                hasTrack: Boolean(publication?.track)
            });
        };
        const handleLocalTrackUnpublished = (publication) => {
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
            if (msg?.type === 'agent_chat' && msg?.text) {
                setCaptions(msg.text);
                setTimeout(() => setCaptions((prev) => (prev === msg.text ? '' : prev)), 8000);
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
        try {
            const next = !isSharingScreen;
            await room.localParticipant.setScreenShareEnabled(next);
            setIsSharingScreen(next);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } catch (err) {
            // Best-effort: screen share needs OS-level setup (ReplayKit / MediaProjection)
            // that isn't always available — fail gracefully instead of crashing the call.
            console.warn('Screen share unavailable on this device:', err?.message);
            Alert.alert('Ekran paylaşımı kullanılamıyor', 'Bu cihazda/derlemede ekran paylaşımı desteklenmiyor.');
        }
    };

    // Mutes what you *hear* (the agent's voice), separate from the mic mute
    // above. Sets volume on every currently-subscribed remote audio track,
    // plus the default for tracks that subscribe later (e.g. the agent
    // hasn't published audio yet when this is first tapped).
    const toggleDeafen = async () => {
        const next = !isDeafened;
        const volume = next ? 0 : 1;
        try {
            room?.remoteParticipants?.forEach?.((participant) => {
                participant.audioTrackPublications?.forEach?.((pub) => {
                    pub.track?.setVolume?.(volume);
                });
            });
            await AudioSession.setDefaultRemoteAudioTrackVolume(volume);
            setIsDeafened(next);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } catch (err) {
            console.warn('Failed to toggle headphone audio:', err?.message);
            Alert.alert('Ses kapatılamadı', err?.message || 'Bilinmeyen hata');
        }
    };

    const onEndPress = () => {
        room?.disconnect();
    };

    return (
        <View style={[styles.innerContainer, isPresentingScreen && styles.presentationContainer]}>
            {/* Header info */}
            <View style={[styles.topBar, isPresentingScreen && styles.presentationTopBar]}>
                <View style={[styles.statusDot, reconnecting && styles.statusDotWarn]} />
                <Text style={styles.agentTitle}>{reconnecting ? 'Yeniden bağlanıyor…' : agentName}</Text>
            </View>

            {/* Any shared screen becomes the primary view and is never cropped. */}
            <View style={[styles.visualizerContainer, isPresentingScreen && styles.presentationVisualizer]}>
                {primaryScreenTrack ? (
                    <>
                        <VideoTrack trackRef={primaryScreenTrack} objectFit="contain" style={styles.screenShareTrack} />
                        <View style={remoteScreenTrack ? styles.remoteShareBadge : styles.localShareBadge}>
                            <Text style={styles.shareBadgeText}>
                                {remoteScreenTrack ? 'AI size ürünü gösteriyor' : 'Ekranınız paylaşılıyor'}
                            </Text>
                        </View>
                    </>
                ) : (
                    <AvatarView hasVideo={hasVideo} videoTrackRef={remoteVideoTrack} avatarProvider={avatarProvider} />
                )}

                {isSharingScreen && !localScreenTrack && (
                    <View style={styles.localShareBadge}>
                        <Text style={styles.shareBadgeText}>Ekranınız paylaşılıyor</Text>
                    </View>
                )}
            </View>

            <View style={[styles.controlsWrapper, isPresentingScreen && styles.presentationControls]}>
                <CallControls
                    isMuted={isMuted}
                    toggleMute={toggleMute}
                    isDeafened={isDeafened}
                    toggleDeafen={toggleDeafen}
                    isSharingScreen={isSharingScreen}
                    toggleScreenShare={toggleScreenShare}
                    handleDisconnect={onEndPress}
                />
            </View>

            {!isPresentingScreen && (
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.chatInputContainer}>
                    <TextInput
                        style={styles.chatInput}
                        placeholder="Yazarak da mesaj gönderebilirsiniz…"
                        placeholderTextColor="#64748b"
                        value={chatInput}
                        onChangeText={setChatInput}
                        onSubmitEditing={sendChatMessage}
                        returnKeyType="send"
                    />
                    <TouchableOpacity style={styles.sendButton} onPress={sendChatMessage}>
                        <Text style={styles.sendButtonText}>Gönder</Text>
                    </TouchableOpacity>
                </KeyboardAvoidingView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0b12',
    },
    roomContainer: {
        flex: 1,
    },
    innerContainer: {
        flex: 1,
        justifyContent: 'space-between',
        paddingVertical: 40,
        paddingHorizontal: 24,
    },
    presentationContainer: {
        paddingVertical: 0,
        paddingHorizontal: 0,
    },
    centerContainer: {
        flex: 1,
        backgroundColor: '#0b0b12',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    loadingText: {
        color: '#9ba1b0',
        fontSize: 16,
        marginTop: 16,
    },
    errorHeader: {
        color: '#f87171',
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 8,
    },
    errorDesc: {
        color: '#9ba1b0',
        fontSize: 15,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
    },
    retryButton: {
        backgroundColor: '#6d5efc',
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 32,
        marginBottom: 12,
        width: '80%',
        alignItems: 'center',
    },
    retryText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    backButton: {
        backgroundColor: '#1b1b2a',
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 32,
        width: '80%',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#2d2d44',
    },
    backText: {
        color: '#9ba1b0',
        fontSize: 16,
        fontWeight: '600',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(27, 27, 42, 0.6)',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 30,
        alignSelf: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.05)',
    },
    presentationTopBar: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 54 : 18,
        zIndex: 3,
        backgroundColor: 'rgba(11, 11, 18, 0.82)',
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#10b981',
        marginRight: 10,
    },
    statusDotWarn: {
        backgroundColor: '#f59e0b',
    },
    agentTitle: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },
    visualizerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginVertical: 20,
        width: '100%',
        overflow: 'hidden',
        borderRadius: 24,
    },
    presentationVisualizer: {
        ...StyleSheet.absoluteFillObject,
        marginVertical: 0,
        borderRadius: 0,
        backgroundColor: '#050508',
    },
    screenShareTrack: {
        width: '100%',
        height: '100%',
        backgroundColor: '#050508',
    },
    remoteShareBadge: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 106 : 68,
        left: 14,
        borderRadius: 16,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    localShareBadge: {
        position: 'absolute',
        left: 14,
        top: Platform.OS === 'ios' ? 106 : 68,
        borderRadius: 16,
        backgroundColor: 'rgba(109, 94, 252, 0.92)',
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    shareBadgeText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '700',
    },
    controlsWrapper: {
        width: '100%',
    },
    presentationControls: {
        position: 'absolute',
        zIndex: 3,
        left: 12,
        right: 12,
        bottom: Platform.OS === 'ios' ? 28 : 16,
        width: 'auto',
        borderRadius: 26,
        paddingVertical: 8,
        paddingHorizontal: 6,
        backgroundColor: 'rgba(11, 11, 18, 0.84)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    chatInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 16,
        backgroundColor: '#161626',
        borderRadius: 24,
        paddingHorizontal: 16,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: '#27273e',
    },
    chatInput: {
        flex: 1,
        color: '#ffffff',
        fontSize: 14,
        paddingVertical: 8,
    },
    sendButton: {
        backgroundColor: '#6d5efc',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 8,
        marginLeft: 8,
    },
    sendButtonText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '600',
    },
});
