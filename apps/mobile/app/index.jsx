import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

/**
 * Branded landing screen.
 *
 * İKİ KULLANIM ŞEKLİ:
 *   1) Deep link: "salesai://v/ABC123" → Expo Router doğrudan v/[token] açar,
 *      bu ekran hiç görünmez.
 *   2) Manuel: kullanıcı uygulamayı açıp toplantı kodunu elle girer → bu ekran.
 *
 * Buradan asıl toplantı ekranına (v/[token]) yönlendiriyoruz; gerçek bağlantı
 * orada WebView içinde kuruluyor.
 */
export default function Home() {
    const router = useRouter();
    const [code, setCode] = useState('');

    function join() {
        const t = code.trim();
        if (!t) return;
        router.push(`/v/${t}`); // toplantı ekranına git, kodu parametre olarak geçir
    }

    return (
        <View style={s.container}>
            <StatusBar style="light" />

            <Text style={s.brand}>SalesAI</Text>
            <Text style={s.subtitle}>Talk to your AI sales representative</Text>

            <TextInput
                style={s.input}
                placeholder="Enter your meeting code"
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoCorrect={false}
                value={code}
                onChangeText={setCode}
                onSubmitEditing={join}
            />

            <Pressable
                style={[s.btn, !code.trim() && s.btnDisabled]}
                onPress={join}
                disabled={!code.trim()}
            >
                <Text style={s.btnText}>Join Meeting</Text>
            </Pressable>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0b12', alignItems: 'center', justifyContent: 'center', padding: 32 },
    brand: { color: '#6d5efc', fontSize: 36, fontWeight: '700', letterSpacing: -1 },
    subtitle: { color: '#888', marginTop: 8, marginBottom: 40, fontSize: 15 },
    input: {
        width: '100%',
        backgroundColor: '#16161f',
        color: '#f5f5fa',
        borderWidth: 1,
        borderColor: '#2a2a3a',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        marginBottom: 12,
    },
    btn: { width: '100%', backgroundColor: '#6d5efc', borderRadius: 12, padding: 16, alignItems: 'center' },
    btnDisabled: { opacity: 0.4 },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
