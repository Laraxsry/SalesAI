import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { VideoTrack } from '@livekit/react-native';
import { COLORS } from '../theme';

/**
 * Per-provider presentation metadata. The actual avatar video (Tavus/HeyGen/
 * D-ID/Simli) is rendered by the provider into the room's camera track once
 * connected — LiveKit gives us no way to tell providers apart from the track
 * itself — so provider branching here is about what's shown *before* that
 * track exists and while voice-only sessions never get one at all.
 *
 * The tints stay in the violet / indigo / fuchsia / pink family of the web
 * voice orb's rim (packages/ui/src/voice-orb.jsx). Its blue is only one stop
 * of a gradient there, so no flat blue is used here.
 */
const PROVIDER_META = {
    'voice-only': { label: 'Sesli Görüşme', color: '#8b5cf6', initials: 'AI' },
    tavus: { label: 'Tavus Video Avatarı', color: '#818cf8', initials: 'TV' },
    heygen: { label: 'HeyGen Video Avatarı', color: '#e879f9', initials: 'HG' },
    did: { label: 'D-ID Video Avatarı', color: '#f472b6', initials: 'DID' },
    simli: { label: 'Simli Video Avatarı', color: '#6366f1', initials: 'SM' }
};

function metaFor(provider) {
    return PROVIDER_META[provider] || PROVIDER_META['voice-only'];
}

/** Renders the agent's remote video track when available, else a provider-branded pulsing orb. */
export function AvatarView({ hasVideo, videoTrackRef, avatarProvider }) {
    const meta = metaFor(avatarProvider);
    const isVideoProvider = avatarProvider && avatarProvider !== 'voice-only';
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!hasVideo) {
            const loop = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, { toValue: 1.3, duration: 1500, useNativeDriver: true }),
                    Animated.timing(pulseAnim, { toValue: 1.0, duration: 1500, useNativeDriver: true })
                ])
            );
            loop.start();
            return () => loop.stop();
        }
        pulseAnim.stopAnimation();
    }, [hasVideo, pulseAnim]);

    if (hasVideo) {
        return <VideoTrack trackRef={videoTrackRef} style={styles.videoTrack} />;
    }

    return (
        <View style={styles.avatarWrapper}>
            <Animated.View
                style={[
                    styles.pulseRing,
                    { borderColor: `${meta.color}4d`, backgroundColor: `${meta.color}26`, transform: [{ scale: pulseAnim }] }
                ]}
            />
            <View style={[styles.avatarOrb, { borderColor: meta.color, shadowColor: meta.color }]}>
                <Text style={[styles.avatarInitials, { color: meta.color }]}>{meta.initials}</Text>
            </View>
            <Text style={styles.providerLabel} numberOfLines={1}>
                {isVideoProvider ? `${meta.label} bağlanıyor…` : meta.label}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    videoTrack: {
        width: '100%',
        height: '100%',
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: COLORS.ink,
    },
    // Fixed to the ring's own footprint (not sized by its children) so the
    // provider label below doesn't shift where flex centers this box — the
    // label is positioned outside of it instead of stacking underneath.
    avatarWrapper: {
        width: 140,
        height: 140,
        justifyContent: 'center',
        alignItems: 'center',
    },
    pulseRing: {
        position: 'absolute',
        width: 140,
        height: 140,
        borderRadius: 70,
        borderWidth: 2,
    },
    avatarOrb: {
        width: 120,
        height: 120,
        borderRadius: 60,
        // The web orb's deep indigo disc.
        backgroundColor: '#120d3d',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 15,
        elevation: 6,
    },
    avatarInitials: {
        fontSize: 28,
        fontWeight: '800',
    },
    providerLabel: {
        position: 'absolute',
        top: '100%',
        marginTop: 16,
        width: 220,
        textAlign: 'center',
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: '600',
    },
});
