import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from './_layout';
import { CONFIG } from '../../config';

export default function LoginScreen() {
    const router = useRouter();
    const { token, login } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // A restored session (from SecureStore) already carries a valid token by
    // the time this screen mounts — skip straight to the dashboard.
    useEffect(() => {
        if (token) router.replace('/console/dashboard');
    }, [token]);

    const handleLogin = async () => {
        if (!email.trim() || !password.trim()) {
            setError('Lütfen e-posta ve şifre alanlarını doldurun.');
            return;
        }

        setError('');
        setLoading(true);

        try {
            const res = await fetch(`${CONFIG.API_URL}/api/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), password }),
            });

            if (!res.ok) {
                throw new Error(
                    res.status === 429
                        ? 'Çok fazla giriş denemesi yaptınız. Lütfen daha sonra tekrar deneyin.'
                        : 'E-posta veya şifre hatalı.'
                );
            }

            const data = await res.json();
            login(data.accessToken, data.user, data.refreshToken);

            // Navigate to console dashboard
            router.replace('/console/dashboard');
        } catch (err) {
            console.error('Login failed:', err);
            setError(err.message || 'Giriş yapılamadı. Lütfen tekrar deneyin.');
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
                    <Text style={styles.tagline}>Satıcı Konsolu</Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Satıcı Girişi</Text>
                    <Text style={styles.cardDesc}>Temsilcilere, çalışma alanlarına, potansiyel müşterilere ve canlı görüşme analizlerine erişmek için satıcı hesabınızla giriş yapın.</Text>

                    <TextInput
                        style={[styles.input, error ? styles.inputError : null]}
                        placeholder="E-posta adresi"
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
                        placeholder="Şifre"
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
                        onPress={handleLogin} 
                        activeOpacity={0.8}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                            <Text style={styles.buttonText}>Konsola Giriş Yap</Text>
                        )}
                    </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.backLink} onPress={() => router.push('/console/register')} activeOpacity={0.7}>
                    <Text style={styles.backLinkText}>Hesabınız yok mu? Kayıt olun</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.backLink} onPress={() => router.replace('/')} activeOpacity={0.7}>
                    <Text style={styles.backLinkText}>Ziyaretçi Uygulamasına Dön</Text>
                </TouchableOpacity>

                <View style={styles.footer}>
                    <Text style={styles.footerText}>SalesAI altyapısıyla</Text>
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
