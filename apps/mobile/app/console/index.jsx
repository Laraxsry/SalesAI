import { useState, useEffect } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from './_layout';
import { CONFIG } from '../../config';
import { SellerAuthButton, SellerAuthField, SellerAuthShell, sellerAuthStyles as styles } from '../../src/components/SellerAuthShell';

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
        <SellerAuthShell
            eyebrow="SATIŞ OPERASYON MERKEZİ"
            title="Ekibinize yeniden bağlanın."
            subtitle="Temsilcileri, görüşmeleri ve satış fırsatlarını tek bir güvenli çalışma alanından yönetin."
        >
            <Text style={styles.formLabel}>E-POSTA ADRESİ</Text>
            <SellerAuthField
                icon="mail-outline"
                placeholder="ad@sirket.com"
                value={email}
                onChangeText={(text) => {
                    setEmail(text);
                    if (error) setError('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                error={Boolean(error)}
            />

            <Text style={styles.formLabel}>ŞİFRE</Text>
            <SellerAuthField
                icon="lock-closed-outline"
                placeholder="Şifreniz"
                secureTextEntry
                value={password}
                onChangeText={(text) => {
                    setPassword(text);
                    if (error) setError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                error={Boolean(error)}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <SellerAuthButton loading={loading} onPress={handleLogin}>Konsola giriş yap</SellerAuthButton>

            <TouchableOpacity style={styles.footerLink} onPress={() => router.push('/console/register')} activeOpacity={0.7}>
                <Text style={styles.footerText}>Hesabınız yok mu? <Text style={styles.footerStrong}>Hesap oluşturun</Text></Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.visitorLink} onPress={() => router.replace('/')} activeOpacity={0.7}>
                <Text style={styles.visitorLinkText}>Ziyaretçi uygulamasına dön</Text>
            </TouchableOpacity>
        </SellerAuthShell>
    );
}
