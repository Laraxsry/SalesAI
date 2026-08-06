import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, PermissionsAndroid, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LiveKitRoom, useTracks, useRoomContext, AudioSession } from '@livekit/react-native';
import { Track, RoomEvent } from 'livekit-client';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { CONFIG } from '../../config';
import { saveConversation } from '../../src/savedConversations';
import { getVisitorId } from '../../src/visitorIdentity';
import { AvatarView } from '../../src/components/AvatarView';
import { Captions } from '../../src/components/Captions';
import { CallControls } from '../../src/components/CallControls';

export default function SessionScreen() {
    const { token } = useLocalSearchParams();
    const router = useRouter();

    const [connectionState, setConnectionState] = useState('idle'); // idle, permissions, fetching, connecting, connected, error
    const [errorMessage, setErrorMessage] = useState('');
    const [connDetails, setConnDetails] = useState(null);
    const [agentName, setAgentName] = useState('AI Representative');

    // Prepares the native audio session (speaker/earpiece routing, category) before joining.
    useEffect(() => {
        AudioSession.startAudioSession().catch(() => {});
        return () => {
            AudioSession.stopAudioSession().catch(() => {});
        };
    }, []);

    // Request permissions and fetch connection details
    const startSession = async () => {
        try {
            setConnectionState('permissions');
            if (Platform.OS === 'android') {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                    {
                        title: 'Microphone Permission',
                        message: 'SalesAI needs access to your microphone to converse with the agent.',
                        buttonNeutral: 'Ask Me Later',
                        buttonNegative: 'Cancel',
                        buttonPositive: 'OK',
                    }
                );
                if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                    throw new Error('Microphone permission is required to speak with the agent.');
                }
            }

            setConnectionState('fetching');
            const visitorId = await getVisitorId();
            const res = await fetch(`${CONFIG.API_URL}/api/v1/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shareToken: token, visitorName: 'Mobile Visitor', visitorId: visitorId || undefined }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to start session. The link might be expired or invalid.');
            }

            const data = await res.json();
            setConnDetails(data);
            setConnectionState('connecting');
        } catch (err) {
            console.error('Error starting session:', err);
            setErrorMessage(err.message);
            setConnectionState('error');
        }
    };

    useEffect(() => {
        if (token) {
            startSession();
        }
    }, [token]);

    const handleDisconnect = () => {
        saveConversation({ token, agentName }).catch(() => {});
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
                <Text style={styles.loadingText}>Requesting Microphone Permission...</Text>
            </View>
        );
    }

    if (connectionState === 'fetching') {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#6d5efc" />
                <Text style={styles.loadingText}>Creating session with agent...</Text>
                <TouchableOpacity style={[styles.backButton, { marginTop: 24 }]} onPress={handleDisconnect}>
                    <Text style={styles.backText}>Cancel</Text>
                </TouchableOpacity>
            </View>
        );
    }

    if (connectionState === 'error') {
        return (
            <View style={styles.centerContainer}>
                <Text style={styles.errorHeader}>Connection Failed</Text>
                <Text style={styles.errorDesc}>{errorMessage}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={startSession}>
                    <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/')}>
                    <Text style={styles.backText}>Go Back</Text>
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
                    <Text style={styles.loadingText}>Connecting to LiveKit Server...</Text>
                    <TouchableOpacity style={[styles.backButton, { marginTop: 24 }]} onPress={handleDisconnect}>
                        <Text style={styles.backText}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            )}

            {connDetails && (
                <LiveKitRoom
                    serverUrl={CONFIG.LIVEKIT_URL}
                    token={connDetails.token}
                    connect={true}
                    audio={true}
                    video={false}
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
    const [captions, setCaptions] = useState('');
    const [isDeafened, setIsDeafened] = useState(false);

    // Look for remote camera tracks (the agent video stream)
    const remoteVideoTracks = useTracks([Track.Source.Camera]);
    const hasVideo = remoteVideoTracks.length > 0;

    // Transcription + connection-lifecycle listeners, now on the real room.
    useEffect(() => {
        if (!room) return;

        let unsubscribe = null;
        try {
            if (typeof room.registerTextStreamHandler === 'function') {
                unsubscribe = room.registerTextStreamHandler('lk.transcription', async (reader) => {
                    const text = await reader.readAll();
                    if (text) {
                        setCaptions(text);
                        setTimeout(() => setCaptions((prev) => (prev === text ? '' : prev)), 6000);
                    }
                });
            }
        } catch (e) {
            console.warn('TextStreamHandler registration failed, using event fallback:', e);
        }

        const handleTranscription = (segments) => {
            const text = segments.map((s) => s.text).join(' ');
            if (text) {
                setCaptions(text);
                setTimeout(() => setCaptions((prev) => (prev === text ? '' : prev)), 6000);
            }
        };
        room.on('transcriptionReceived', handleTranscription);

        const handleParticipantConnected = (participant) => {
            if (participant.identity.startsWith('agent_') || participant.identity.includes('worker')) {
                setAgentName(participant.name || 'AI Representative');
            }
        };
        room.on('participantConnected', handleParticipantConnected);
        room.remoteParticipants?.forEach?.(handleParticipantConnected);

        const onReconnecting = () => setReconnecting(true);
        const onReconnected = () => setReconnecting(false);
        room.on(RoomEvent.Reconnecting, onReconnecting);
        room.on(RoomEvent.Reconnected, onReconnected);

        return () => {
            if (unsubscribe) unsubscribe();
            room.off('transcriptionReceived', handleTranscription);
            room.off('participantConnected', handleParticipantConnected);
            room.off(RoomEvent.Reconnecting, onReconnecting);
            room.off(RoomEvent.Reconnected, onReconnected);
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
        handleDisconnect();
    };

    return (
        <View style={styles.innerContainer}>
            {/* Header info */}
            <View style={styles.topBar}>
                <View style={[styles.statusDot, reconnecting && styles.statusDotWarn]} />
                <Text style={styles.agentTitle}>{reconnecting ? 'Yeniden bağlanıyor…' : agentName}</Text>
            </View>

            {/* Video or Voice visualizer, branded per avatarProvider */}
            <View style={styles.visualizerContainer}>
                <AvatarView hasVideo={hasVideo} videoTrackRef={remoteVideoTracks[0]} avatarProvider={avatarProvider} />
            </View>

            <Captions text={captions} />

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
        marginVertical: 40,
    },
});
