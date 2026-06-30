import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

/**
 * Mobile visitor entry. The full build joins a LiveKit room via
 * @livekit/react-native to talk to the AI rep (voice + avatar video).
 */
export default function Home() {
    return (
        <View style={styles.container}>
            <StatusBar style="light" />
            <Text style={styles.brand}>SalesAI</Text>
            <Text style={styles.subtitle}>Talk to your AI sales representative</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0b12', alignItems: 'center', justifyContent: 'center' },
    brand: { color: '#6d5efc', fontSize: 32, fontWeight: '700' },
    subtitle: { color: '#f5f5fa', marginTop: 8 }
});
