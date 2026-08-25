import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

function Control({ icon, label, onPress, active = false, danger = false }) {
    return (
        <TouchableOpacity
            style={[styles.controlButton, active && styles.controlButtonActive, danger && styles.controlButtonDanger]}
            onPress={onPress}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Ionicons name={icon} size={20} color={active && !danger ? COLORS.ink : COLORS.white} />
        </TouchableOpacity>
    );
}

/** Web-aligned microphone, screen-share and end-call controls. */
export function CallControls({
    isMuted,
    toggleMute,
    isSharingScreen,
    toggleScreenShare,
    handleDisconnect
}) {
    return (
        <View style={styles.controlsContainer}>
            <Control
                icon={isMuted ? 'mic-off' : 'mic'}
                label={isMuted ? 'Sesi aç' : 'Mikrofon'}
                onPress={toggleMute}
                danger={isMuted}
            />
            <Control
                icon={isSharingScreen ? 'stop-circle' : 'share-outline'}
                label={isSharingScreen ? 'Durdur' : 'Paylaş'}
                onPress={toggleScreenShare}
                active={isSharingScreen}
            />
            <Control icon="call" label="Bitir" onPress={handleDisconnect} danger />
        </View>
    );
}

const styles = StyleSheet.create({
    controlsContainer: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    controlButton: {
        width: 50,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.07)',
    },
    controlButtonActive: {
        borderColor: COLORS.lime,
        backgroundColor: COLORS.lime,
    },
    controlButtonDanger: {
        borderColor: 'rgba(231,88,74,0.45)',
        backgroundColor: COLORS.danger,
    },
});
