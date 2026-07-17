import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Platform, PermissionsAndroid, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LiveKitRoom, VideoTrack, useTracks, AudioSession } from '@livekit/react-native';
import { Track, RoomEvent } from 'livekit-client';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { CONFIG } from '../../config';
import { saveConversation } from '../../src/savedConversations';

// Simple SVG-like icons built using pure React Native components for maximum compatibility
const MuteIcon = ({ color }) => (
    <View style={styles.iconContainer}>
        <View style={[styles.micStem, { backgroundColor: color }]} />
        <View style={[styles.micBowl, { borderColor: color }]} />
        <View style={[styles.micStand, { backgroundColor: color }]} />
    </View>
);

const PhoneIcon = () => (
    <View style={styles.iconContainer}>
        <View style={styles.phoneBase} />
    </View>
);

const SpeakerIcon = () => (
    <View style={styles.iconContainer}>
        <View style={styles.speakerBody} />
        <View style={styles.speakerWaveOuter} />
    </View>
);

const ScreenShareIcon = ({ active }) => (
    <View style={styles.iconContainer}>
        <View style={[styles.screenRect, active && styles.screenRectActive]} />
    </View>
);

export default function SessionScreen() {
    const { token } = useLocalSearchParams();
    const router = useRouter();

    const [connectionState, setConnectionState] = useState('idle'); // idle, permissions, fetching, connecting, connected, error
    const [errorMessage, setErrorMessage] = useState('');
    const [connDetails, setConnDetails] = useState(null);
    const [activeRoom, setActiveRoom] = useState(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isSharingScreen, setIsSharingScreen] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [captions, setCaptions] = useState('');
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
            const res = await fetch(`${CONFIG.API_URL}/api/v1/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shareToken: token, visitorName: 'Mobile Visitor' }),
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

    // Setup transcription + connection-lifecycle listeners on the room
    useEffect(() => {
        if (!activeRoom) return;

        let unsubscribe = null;

        try {
            // 1. Try modern registerTextStreamHandler
            if (typeof activeRoom.registerTextStreamHandler === 'function') {
                unsubscribe = activeRoom.registerTextStreamHandler(
                    'lk.transcription',
                    async (reader, participantInfo) => {
                        const text = await reader.readAll();
                        if (text) {
                            setCaptions(text);
                            // Clear captions after 6 seconds of silence
                            setTimeout(() => {
                                setCaptions((prev) => (prev === text ? '' : prev));
                            }, 6000);
                        }
                    }
                );
            }
        } catch (e) {
            console.warn('TextStreamHandler registration failed, using event fallback:', e);
        }

        // 2. Event fallback for transcriptionReceived
        const handleTranscription = (segments, participant) => {
            const text = segments.map((s) => s.text).join(' ');
            if (text) {
                setCaptions(text);
                setTimeout(() => {
                    setCaptions((prev) => (prev === text ? '' : prev));
                }, 6000);
            }
        };

        activeRoom.on('transcriptionReceived', handleTranscription);

        // Track when remote participants publish screen share or join
        const handleParticipantConnected = (participant) => {
            if (participant.identity.startsWith('agent_') || participant.identity.includes('worker')) {
                setAgentName(participant.name || 'AI Representative');
            }
        };

        activeRoom.on('participantConnected', handleParticipantConnected);
        activeRoom.participants.forEach(handleParticipantConnected);

        // Reconnection lifecycle — wifi<->cellular switches, brief network drops, etc.
        const onReconnecting = () => setReconnecting(true);
        const onReconnected = () => setReconnecting(false);

        activeRoom.on(RoomEvent.Reconnecting, onReconnecting);
        activeRoom.on(RoomEvent.Reconnected, onReconnected);

        return () => {
            if (unsubscribe) unsubscribe();
            activeRoom.off('transcriptionReceived', handleTranscription);
            activeRoom.off('participantConnected', handleParticipantConnected);
            activeRoom.off(RoomEvent.Reconnecting, onReconnecting);
            activeRoom.off(RoomEvent.Reconnected, onReconnected);
        };
    }, [activeRoom]);

    const handleRoomConnected = (room) => {
        setActiveRoom(room);
        setConnectionState('connected');
    };

    const handleDisconnect = () => {
        saveConversation({ token, agentName }).catch(() => {});
        if (activeRoom) {
            activeRoom.disconnect();
        }
        router.replace('/');
    };

    const toggleMute = async () => {
        if (activeRoom && activeRoom.localParticipant) {
            const nextMuted = !isMuted;
            await activeRoom.localParticipant.setMicrophoneEnabled(!nextMuted);
            setIsMuted(nextMuted);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
    };

    const toggleScreenShare = async () => {
        if (!activeRoom?.localParticipant) return;
        try {
            const next = !isSharingScreen;
            await activeRoom.localParticipant.setScreenShareEnabled(next);
            setIsSharingScreen(next);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } catch (err) {
            // Best-effort: screen share needs OS-level setup (ReplayKit / MediaProjection)
            // that isn't always available — fail gracefully instead of crashing the call.
            console.warn('Screen share unavailable on this device:', err?.message);
            Alert.alert('Ekran paylaşımı kullanılamıyor', 'Bu cihazda/derlemede ekran paylaşımı desteklenmiyor.');
        }
    };

    const openAudioRoutePicker = () => {
        AudioSession.showAudioRoutePicker().catch((err) => {
            console.warn('Audio route picker unavailable:', err?.message);
        });
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
                    onConnected={handleRoomConnected}
                    onDisconnected={handleDisconnect}
                    style={styles.roomContainer}
                >
                    <RoomView
                        agentName={agentName}
                        isMuted={isMuted}
                        toggleMute={toggleMute}
                        isSharingScreen={isSharingScreen}
                        toggleScreenShare={toggleScreenShare}
                        openAudioRoutePicker={openAudioRoutePicker}
                        handleDisconnect={handleDisconnect}
                        captions={captions}
                        reconnecting={reconnecting}
                    />
                </LiveKitRoom>
            )}
        </View>
    );
}

// Inner view that uses hooks and handles track state
function RoomView({
    agentName,
    isMuted,
    toggleMute,
    isSharingScreen,
    toggleScreenShare,
    openAudioRoutePicker,
    handleDisconnect,
    captions,
    reconnecting
}) {
    // Look for remote camera tracks (the agent video stream)
    const remoteVideoTracks = useTracks([Track.Source.Camera]);
    const hasVideo = remoteVideoTracks.length > 0;

    // Pulsing animation for voice-only mode
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!hasVideo) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.3,
                        duration: 1500,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1.0,
                        duration: 1500,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            pulseAnim.stopAnimation();
        }
    }, [hasVideo]);

    return (
        <View style={styles.innerContainer}>
            {/* Header info */}
            <View style={styles.topBar}>
                <View style={[styles.statusDot, reconnecting && styles.statusDotWarn]} />
                <Text style={styles.agentTitle}>{reconnecting ? 'Yeniden bağlanıyor…' : agentName}</Text>
            </View>

            {/* Video or Voice visualizer */}
            <View style={styles.visualizerContainer}>
                {hasVideo ? (
                    <VideoTrack
                        trackRef={remoteVideoTracks[0]}
                        style={styles.videoTrack}
                    />
                ) : (
                    <View style={styles.avatarWrapper}>
                        <Animated.View
                            style={[
                                styles.pulseRing,
                                {
                                    transform: [{ scale: pulseAnim }],
                                },
                            ]}
                        />
                        <View style={styles.avatarOrb}>
                            <Text style={styles.avatarInitials}>AI</Text>
                        </View>
                    </View>
                )}
            </View>

            {/* Real-time captions */}
            <View style={styles.captionsContainer}>
                {captions ? (
                    <View style={styles.captionsBox}>
                        <Text style={styles.captionsText}>{captions}</Text>
                    </View>
                ) : (
                    <Text style={styles.listeningText}>Listening to agent...</Text>
                )}
            </View>

            {/* Controls */}
            <View style={styles.controlsContainer}>
                <TouchableOpacity
                    style={[styles.controlButton, isMuted ? styles.controlMuted : styles.controlActive]}
                    onPress={toggleMute}
                    activeOpacity={0.8}
                >
                    <MuteIcon color="#ffffff" />
                    <Text style={styles.controlText}>{isMuted ? 'Unmute' : 'Mute'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.controlButton, styles.controlActive]}
                    onPress={openAudioRoutePicker}
                    activeOpacity={0.8}
                >
                    <SpeakerIcon />
                    <Text style={styles.controlText}>Speaker</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.controlButton, isSharingScreen ? styles.controlSharing : styles.controlActive]}
                    onPress={toggleScreenShare}
                    activeOpacity={0.8}
                >
                    <ScreenShareIcon active={isSharingScreen} />
                    <Text style={styles.controlText}>Share</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.controlButton, styles.controlEnd]}
                    onPress={handleDisconnect}
                    activeOpacity={0.8}
                >
                    <PhoneIcon />
                    <Text style={styles.controlText}>End</Text>
                </TouchableOpacity>
            </View>
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
    videoTrack: {
        width: '100%',
        height: '100%',
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: '#13131e',
    },
    avatarWrapper: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    pulseRing: {
        position: 'absolute',
        width: 140,
        height: 140,
        borderRadius: 70,
        backgroundColor: 'rgba(109, 94, 252, 0.15)',
        borderWidth: 2,
        borderColor: 'rgba(109, 94, 252, 0.3)',
    },
    avatarOrb: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: '#1b1b2a',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: '#6d5efc',
        shadowColor: '#6d5efc',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 15,
        elevation: 6,
    },
    avatarInitials: {
        color: '#6d5efc',
        fontSize: 32,
        fontWeight: '800',
    },
    captionsContainer: {
        minHeight: 120,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    captionsBox: {
        backgroundColor: 'rgba(27, 27, 42, 0.85)',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        width: '100%',
    },
    captionsText: {
        color: '#f5f5fa',
        fontSize: 16,
        textAlign: 'center',
        lineHeight: 24,
    },
    listeningText: {
        color: '#4e5564',
        fontSize: 14,
        fontStyle: 'italic',
    },
    controlsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        width: '100%',
    },
    controlButton: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 68,
        height: 68,
        borderRadius: 34,
    },
    controlActive: {
        backgroundColor: '#1b1b2a',
        borderWidth: 1,
        borderColor: '#2d2d44',
    },
    controlMuted: {
        backgroundColor: '#ef4444',
    },
    controlSharing: {
        backgroundColor: '#6d5efc',
    },
    controlEnd: {
        backgroundColor: '#f87171',
    },
    controlText: {
        color: '#9ba1b0',
        fontSize: 11,
        marginTop: 4,
        fontWeight: '500',
    },

    // Custom Icon styles
    iconContainer: {
        width: 28,
        height: 28,
        justifyContent: 'center',
        alignItems: 'center',
    },
    micStem: {
        width: 8,
        height: 16,
        borderRadius: 4,
        position: 'absolute',
        top: 4,
    },
    micBowl: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
        borderTopWidth: 0,
        position: 'absolute',
        bottom: 8,
    },
    micStand: {
        width: 2,
        height: 6,
        position: 'absolute',
        bottom: 2,
    },
    phoneBase: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#ffffff',
        transform: [{ rotate: '135deg' }],
    },
    speakerBody: {
        width: 14,
        height: 14,
        borderRadius: 3,
        backgroundColor: '#ffffff',
    },
    speakerWaveOuter: {
        position: 'absolute',
        right: 2,
        width: 10,
        height: 18,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#ffffff',
        borderLeftColor: 'transparent',
        borderBottomColor: 'transparent',
        transform: [{ rotate: '45deg' }],
    },
    screenRect: {
        width: 22,
        height: 16,
        borderRadius: 3,
        borderWidth: 2,
        borderColor: '#ffffff',
    },
    screenRectActive: {
        backgroundColor: 'rgba(255,255,255,0.2)',
    },
});
