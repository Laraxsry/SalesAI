import { useEffect, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    FlatList,
    Platform
} from 'react-native';
import {
    useTracks,
    useRoomContext,
    useLocalParticipant,
    VideoTrack,
    isTrackReference
} from '@livekit/react-native';
import { Track, RoomEvent } from 'livekit-client';

/**
 * In-call UI: remote avatar video, live captions, mute, end.
 */
export function RoomView({ onLeave }) {
    const room = useRoomContext();
    const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
    const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
    const [captions, setCaptions] = useState([]);
    const [reconnecting, setReconnecting] = useState(false);

    useEffect(() => {
        if (!room) return undefined;

        const onTranscription = (segments) => {
            const lines = (segments || [])
                .map((s) => s?.text?.trim())
                .filter(Boolean);
            if (!lines.length) return;
            setCaptions((prev) => [...prev, ...lines].slice(-8));
        };

        const onReconnecting = () => setReconnecting(true);
        const onReconnected = () => setReconnecting(false);
        const onDisconnected = () => setReconnecting(false);

        room.on(RoomEvent.TranscriptionReceived, onTranscription);
        room.on(RoomEvent.Reconnecting, onReconnecting);
        room.on(RoomEvent.Reconnected, onReconnected);
        room.on(RoomEvent.Disconnected, onDisconnected);

        return () => {
            room.off(RoomEvent.TranscriptionReceived, onTranscription);
            room.off(RoomEvent.Reconnecting, onReconnecting);
            room.off(RoomEvent.Reconnected, onReconnected);
            room.off(RoomEvent.Disconnected, onDisconnected);
        };
    }, [room]);

    async function toggleMute() {
        if (!localParticipant) return;
        await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    }

    async function endCall() {
        try {
            await room?.disconnect();
        } finally {
            onLeave?.();
        }
    }

    const remoteVideo = tracks.filter(
        (t) => isTrackReference(t) && !t.participant.isLocal
    );

    return (
        <View style={styles.container}>
            <View style={styles.videoArea}>
                {remoteVideo.length ? (
                    <FlatList
                        data={remoteVideo}
                        keyExtractor={(item, i) =>
                            isTrackReference(item)
                                ? `${item.participant.identity}-${item.publication?.trackSid || i}`
                                : String(i)
                        }
                        renderItem={({ item }) =>
                            isTrackReference(item) ? (
                                <VideoTrack trackRef={item} style={styles.video} />
                            ) : (
                                <View style={styles.video} />
                            )
                        }
                        style={styles.videoList}
                    />
                ) : (
                    <View style={styles.placeholder}>
                        <Text style={styles.placeholderTitle}>AI Sales Rep</Text>
                        <Text style={styles.placeholderHint}>
                            Waiting for avatar video…
                        </Text>
                    </View>
                )}

                {reconnecting ? (
                    <View style={styles.banner}>
                        <Text style={styles.bannerText}>Reconnecting…</Text>
                    </View>
                ) : null}

                {captions.length ? (
                    <View style={styles.captions}>
                        {captions.slice(-3).map((line, i) => (
                            <Text key={`${i}-${line.slice(0, 12)}`} style={styles.captionLine}>
                                {line}
                            </Text>
                        ))}
                    </View>
                ) : null}
            </View>

            <View style={styles.controls}>
                <Pressable
                    style={[styles.btn, !isMicrophoneEnabled && styles.btnMuted]}
                    onPress={toggleMute}
                >
                    <Text style={styles.btnText}>
                        {isMicrophoneEnabled ? 'Mute' : 'Unmute'}
                    </Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnEnd]} onPress={endCall}>
                    <Text style={styles.btnText}>End</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0b12' },
    videoArea: { flex: 1, position: 'relative' },
    videoList: { flex: 1 },
    video: { width: '100%', flex: 1, minHeight: 320, backgroundColor: '#111' },
    placeholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32
    },
    placeholderTitle: { color: '#6d5efc', fontSize: 28, fontWeight: '700' },
    placeholderHint: { color: '#888', marginTop: 8, fontSize: 15 },
    banner: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 56 : 16,
        alignSelf: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20
    },
    bannerText: { color: '#f5f5fa', fontSize: 13, fontWeight: '600' },
    captions: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 24,
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderRadius: 12,
        padding: 12
    },
    captionLine: { color: '#f5f5fa', fontSize: 15, lineHeight: 22, marginBottom: 4 },
    controls: {
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: Platform.OS === 'ios' ? 36 : 20,
        backgroundColor: '#0b0b12'
    },
    btn: {
        flex: 1,
        backgroundColor: '#2a2a3a',
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center'
    },
    btnMuted: { backgroundColor: '#5a4fd6' },
    btnEnd: { backgroundColor: '#c43c3c' },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 16 }
});
