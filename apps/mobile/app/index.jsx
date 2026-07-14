import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

/**
 * Mobile visitor landing. The user enters an agent token or share link 
 * to connect to their AI sales representative.
 */
export default function Home() {
    const router = useRouter();
    const [input, setInput] = useState('');
    const [error, setError] = useState('');

    const handleConnect = () => {
        if (!input.trim()) {
            setError('Please enter a valid share link or token');
            return;
        }

        setError('');
        let token = input.trim();

        // If the user inputs a full link (universal link or deep link), extract the token
        // e.g. salesai://v/some-token or http://.../v/some-token
        const tokenMatch = token.match(/(?:v\/|v=)([a-zA-Z0-9_-]+)/) || token.match(/\/v\/([a-zA-Z0-9_-]+)/);
        if (tokenMatch && tokenMatch[1]) {
            token = tokenMatch[1];
        }

        // Navigate to the video call screen with the token
        router.push(`/v/${token}`);
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardContainer}
        >
            <StatusBar style="light" />
            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.header}>
                    <Text style={styles.brand}>SalesAI</Text>
                    <Text style={styles.tagline}>Talk to your AI sales representative</Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Join AI Conversation</Text>
                    <Text style={styles.cardDesc}>Enter your representative's share link or token below to start a voice and video session.</Text>

                    <TextInput
                        style={[styles.input, error ? styles.inputError : null]}
                        placeholder="e.g. agent_token_abc"
                        placeholderTextColor="#6c727f"
                        value={input}
                        onChangeText={(text) => {
                            setInput(text);
                            if (error) setError('');
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />

                    {error ? <Text style={styles.errorText}>{error}</Text> : null}

                    <TouchableOpacity style={styles.button} onPress={handleConnect} activeOpacity={0.8}>
                        <Text style={styles.buttonText}>Connect to Representative</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.footer}>
                    <Text style={styles.footerText}>Powered by LiveKit WebRTC & SalesAI</Text>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    keyboardContainer: {
        flex: 1,
        backgroundColor: '#0b0b12',
    },
    scrollContainer: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: 24,
    },
    header: {
        alignItems: 'center',
        marginBottom: 48,
    },
    brand: {
        color: '#6d5efc',
        fontSize: 40,
        fontWeight: '800',
        letterSpacing: 1,
        textShadowColor: 'rgba(109, 94, 252, 0.3)',
        textShadowOffset: { width: 0, height: 4 },
        textShadowRadius: 10,
    },
    tagline: {
        color: '#9ba1b0',
        fontSize: 16,
        marginTop: 12,
        textAlign: 'center',
    },
    card: {
        backgroundColor: '#13131e',
        borderRadius: 20,
        padding: 24,
        borderWidth: 1,
        borderColor: '#242436',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 8,
    },
    cardTitle: {
        color: '#ffffff',
        fontSize: 20,
        fontWeight: '700',
        marginBottom: 8,
    },
    cardDesc: {
        color: '#9ba1b0',
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 24,
    },
    input: {
        backgroundColor: '#1b1b2a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#2d2d44',
        color: '#ffffff',
        fontSize: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 16,
    },
    inputError: {
        borderColor: '#f87171',
    },
    errorText: {
        color: '#f87171',
        fontSize: 14,
        marginBottom: 16,
        marginTop: -8,
        paddingLeft: 4,
    },
    button: {
        backgroundColor: '#6d5efc',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
        shadowColor: '#6d5efc',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 4,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    footer: {
        marginTop: 48,
        alignItems: 'center',
    },
    footerText: {
        color: '#4e5564',
        fontSize: 12,
    },
});
