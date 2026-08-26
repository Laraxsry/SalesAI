import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { verifyMagicLink } from '../../src/visitorIdentity';
import { useAppTheme } from '../../src/theme-context';

/**
 * Deep-link target for the magic link sent by POST /auth/magic-link:
 * salesai://auth/verify?token=... (see src/visitorIdentity.js requestMagicLink).
 */
export default function VerifyMagicLinkScreen() {
    const { token } = useLocalSearchParams();
    const router = useRouter();
    const { colors, isDark } = useAppTheme();
    const styles = createStyles(colors);
    const [status, setStatus] = useState('verifying'); // verifying, success, error
    const [error, setError] = useState('');
    const [email, setEmail] = useState('');

    useEffect(() => {
        if (!token) {
            setStatus('error');
            setError('Bağlantıda token bulunamadı.');
            return;
        }
        verifyMagicLink(token)
            .then((data) => {
                setEmail(data.email);
                setStatus('success');
            })
            .catch((err) => {
                setError(err.message);
                setStatus('error');
            });
    }, [token]);

    return (
        <View style={styles.container}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            {status === 'verifying' && (
                <>
                    <ActivityIndicator size="large" color={colors.teal} />
                    <Text style={styles.text}>Bağlantı doğrulanıyor…</Text>
                </>
            )}
            {status === 'success' && (
                <>
                    <Text style={styles.title}>Senkronize edildi</Text>
                    <Text style={styles.text}>{email} ile görüşmelerin artık bu cihazda da görünecek.</Text>
                    <TouchableOpacity style={styles.button} onPress={() => router.replace('/saved')}>
                        <Text style={styles.buttonText}>Kayıtlı görüşmelere git</Text>
                    </TouchableOpacity>
                </>
            )}
            {status === 'error' && (
                <>
                    <Text style={[styles.title, { color: colors.danger }]}>Doğrulanamadı</Text>
                    <Text style={styles.text}>{error}</Text>
                    <TouchableOpacity style={styles.button} onPress={() => router.replace('/saved')}>
                        <Text style={styles.buttonText}>Geri dön</Text>
                    </TouchableOpacity>
                </>
            )}
        </View>
    );
}

const createStyles = (colors) => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
    text: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 12, lineHeight: 20 },
    button: {
        marginTop: 24,
        backgroundColor: colors.tealDark,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 28,
    },
    buttonText: { color: colors.white, fontSize: 15, fontWeight: '600' },
});
