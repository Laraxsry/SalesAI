import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

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

const HeadphoneIcon = ({ muted }) => (
    <View style={styles.iconContainer}>
        <View style={[styles.headphoneBand, muted && styles.headphoneBandMuted]} />
        <View style={[styles.headphoneEarcup, styles.headphoneEarcupLeft, muted && styles.headphoneEarcupMuted]} />
        <View style={[styles.headphoneEarcup, styles.headphoneEarcupRight, muted && styles.headphoneEarcupMuted]} />
        {muted && <View style={styles.headphoneSlash} />}
    </View>
);

const ScreenShareIcon = ({ active }) => (
    <View style={styles.iconContainer}>
        <View style={[styles.screenRect, active && styles.screenRectActive]} />
    </View>
);

/** The mute / headphone (output mute) / screen-share / end-call row shown during a live session. */
export function CallControls({
    isMuted,
    toggleMute,
    isDeafened,
    toggleDeafen,
    isSharingScreen,
    toggleScreenShare,
    handleDisconnect
}) {
    return (
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
                style={[styles.controlButton, isDeafened ? styles.controlMuted : styles.controlActive]}
                onPress={toggleDeafen}
                activeOpacity={0.8}
            >
                <HeadphoneIcon muted={isDeafened} />
                <Text style={styles.controlText}>{isDeafened ? 'Sesi Aç' : 'Kulaklık'}</Text>
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
    );
}

const styles = StyleSheet.create({
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
    headphoneBand: {
        position: 'absolute',
        top: 2,
        width: 18,
        height: 12,
        borderTopLeftRadius: 9,
        borderTopRightRadius: 9,
        borderWidth: 2,
        borderBottomWidth: 0,
        borderColor: '#ffffff',
    },
    headphoneBandMuted: {
        borderColor: '#ffffff',
    },
    headphoneEarcup: {
        position: 'absolute',
        bottom: 4,
        width: 7,
        height: 10,
        borderRadius: 3,
        backgroundColor: '#ffffff',
    },
    headphoneEarcupLeft: {
        left: 2,
    },
    headphoneEarcupRight: {
        right: 2,
    },
    headphoneEarcupMuted: {
        backgroundColor: '#ffffff',
    },
    headphoneSlash: {
        position: 'absolute',
        width: 26,
        height: 2,
        backgroundColor: '#ffffff',
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
