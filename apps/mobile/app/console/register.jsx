import { useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from './_layout';
import { CONFIG } from '../../config';
import { SellerAuthButton, SellerAuthField, SellerAuthShell, sellerAuthStyles as styles } from '../../src/components/SellerAuthShell';

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
            setError('Lütfen ad, e-posta ve şifre alanlarını doldurun.');
            return;
        }
        if (password.length < 8) {
            setError('Şifre en az 8 karakter olmalıdır.');
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
                throw new Error(
                    res.status === 409
                        ? 'Bu e-posta adresiyle daha önce kayıt oluşturulmuş.'
                        : 'Hesap oluşturulamadı. Lütfen tekrar deneyin.'
                );
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
        <SellerAuthShell
            eyebrow="YENİ ÇALIŞMA ALANI"
            title="Satış operasyonunuzu kurun."
            subtitle="AI temsilcinizi oluşturun, görüşmeleri ölçün ve fırsatları ekibinizle birlikte yönetin."
        >
            <Text style={styles.formLabel}>AD SOYAD</Text>
            <SellerAuthField
                icon="person-outline"
                placeholder="Adınız ve soyadınız"
                value={name}
                onChangeText={(text) => {
                    setName(text);
                    if (error) setError('');
                }}
                autoCapitalize="words"
                autoCorrect={false}
                error={Boolean(error)}
            />

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
                placeholder="En az 8 karakter"
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
            <SellerAuthButton loading={loading} onPress={handleRegister}>Hesap oluştur</SellerAuthButton>

            <TouchableOpacity style={styles.footerLink} onPress={() => router.replace('/console')} activeOpacity={0.7}>
                <Text style={styles.footerText}>Zaten hesabınız var mı? <Text style={styles.footerStrong}>Giriş yapın</Text></Text>
            </TouchableOpacity>
        </SellerAuthShell>
    );
}
