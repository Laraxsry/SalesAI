import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT } from '../theme';

function Control({ icon, label, onPress, active = false, danger = false }) {
    return (
        <TouchableOpacity style={styles.controlItem} onPress={onPress} activeOpacity={0.78} accessibilityLabel={label}>
            <View style={[styles.controlButton, active && styles.controlButtonActive, danger && styles.controlButtonDanger]}>
                <Ionicons
                    name={icon}
                    size={21}
                    color={active ? COLORS.ink : COLORS.white}
                />
            </View>
            <Text style={[styles.controlText, danger && styles.controlTextDanger]}>{label}</Text>
        </TouchableOpacity>
    );
}

/** Microphone, remote audio, screen-share and end-call controls for a live session. */
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
            <Control
                icon={isMuted ? 'mic-off' : 'mic'}
                label={isMuted ? 'Sesi aç' : 'Mikrofon'}
                onPress={toggleMute}
                active={isMuted}
            />
            <Control
                icon={isDeafened ? 'volume-mute' : 'volume-high'}
                label={isDeafened ? 'Sesi aç' : 'Hoparlör'}
                onPress={toggleDeafen}
                active={isDeafened}
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
        alignItems: 'flex-start',
        justifyContent: 'space-between',
    },
    controlItem: {
        width: 70,
        alignItems: 'center',
    },
    controlButton: {
        width: 54,
        height: 54,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.075)',
    },
    controlButtonActive: {
        borderColor: COLORS.lime,
        backgroundColor: COLORS.lime,
    },
    controlButtonDanger: {
        borderColor: 'rgba(231,88,74,0.55)',
        backgroundColor: COLORS.danger,
    },
    controlText: {
        marginTop: 7,
        color: 'rgba(255,255,255,0.55)',
        fontFamily: FONT.medium,
        fontSize: 10.5,
    },
    controlTextDanger: {
        color: '#FFB1A8',
    },
});
