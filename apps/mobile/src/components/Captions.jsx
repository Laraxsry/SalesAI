import { View, Text, StyleSheet } from 'react-native';

/** Live transcription captions, or a "listening" placeholder while the agent is silent. */
export function Captions({ text }) {
    return (
        <View style={styles.captionsContainer}>
            {text ? (
                <View style={styles.captionsBox}>
                    <Text style={styles.captionsText}>{text}</Text>
                </View>
            ) : (
                <Text style={styles.listeningText}>Temsilci dinleniyor…</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
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
});
