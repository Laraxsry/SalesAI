import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from './_layout';
import { CONFIG } from '../../config';

export default function RegisterScreen() {
    const router = useRouter();
    const { login } = useAuth();

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleRegister = async () => {
        if (!name.trim() || !email.trim() || !password.trim()) {
            setError('Please fill in name, email and password');
            return;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setError('');
        setLoading(true);

        try {
            const res = await fetch(`${CONFIG.API_URL}/api/v1/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Could not create account');
            }

            const data = await res.json();
            login(data.accessToken, data.user, data.refreshToken);

            // Same backend/account system as web — this seller can now log
            // into the web console with the same credentials, and vice versa.
            router.replace('/console/dashboard');
        } catch (err) {
            console.error('Registration failed:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
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
                    <Text style={styles.tagline}>Create your seller account</Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Seller Sign Up</Text>
                    <Text style={styles.cardDesc}>Create an account to build agents, monitor calls, and track leads — from web or mobile.</Text>

                    <TextInput
                        style={[styles.input, error ? styles.inputError : null]}
                        placeholder="Full Name"
                        placeholderTextColor="#6c727f"
                        value={name}
                        onChangeText={(text) => {
                            setName(text);
                            if (error) setError('');
                        }}
                        autoCapitalize="words"
                        autoCorrect={false}
                    />

                    <TextInput
                        style={[styles.input, error ? styles.inputError : null]}
                        placeholder="Email Address"
                        placeholderTextColor="#6c727f"
                        value={email}
                        onChangeText={(text) => {
                            setEmail(text);
                            if (error) setError('');
                        }}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoCorrect={false}
                    />

                    <TextInput
                        style={[styles.input, error ? styles.inputError : null]}
                        placeholder="Password (min. 8 characters)"
                        placeholderTextColor="#6c727f"
                        secureTextEntry
                        value={password}
                        onChangeText={(text) => {
                            setPassword(text);
                            if (error) setError('');
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />

                    {error ? <Text style={styles.errorText}>{error}</Text> : null}

                    <TouchableOpacity
                        style={styles.button}
                        onPress={handleRegister}
                        activeOpacity={0.8}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                            <Text style={styles.buttonText}>Create Account</Text>
                        )}
                    </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.backLink} onPress={() => router.replace('/console')} activeOpacity={0.7}>
                    <Text style={styles.backLinkText}>Already have an account? Log in</Text>
                </TouchableOpacity>

                <View style={styles.footer}>
                    <Text style={styles.footerText}>Powered by SalesAI Dashboard</Text>
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
        justifyContent: 'center',
        minHeight: 52,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    backLink: {
        marginTop: 24,
        alignSelf: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    backLinkText: {
        color: '#9ba1b0',
        fontSize: 14,
        fontWeight: '600',
        textDecorationLine: 'underline',
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
