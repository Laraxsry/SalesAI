import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';

// ─── Ortam değişkeni ────────────────────────────────────────────────────────
// Web visitor uygulamasının adresi. apps/visitor varsayılan olarak 5174 portunda.
// Simülatörde localhost çalışır; FİZİKSEL telefonda Mac'in LAN IP'siyle değiştir
// (.env içindeki EXPO_PUBLIC_VISITOR_URL). Örn: http://192.168.1.42:5174
const VISITOR_URL = process.env.EXPO_PUBLIC_VISITOR_URL ?? 'http://localhost:5174';

/**
 * Toplantı ekranı — EXPO GO UYUMLU.
 *
 * NASIL ÇALIŞIYOR?
 * Native LiveKit Expo Go'da çalışmadığı için, zaten çalışan web visitor
 * uygulamasını ("apps/visitor") bir WebView içinde açıyoruz. WebView, telefonun
 * tarayıcı motorudur (iOS'ta WKWebView) ve WebRTC + mikrofon destekler.
 * Yani ses + avatar video gerçekten çalışır; sadece native değil, web motorunda.
 *
 *   salesai://v/ABC123  →  WebView  →  http://<host>:5174/v/ABC123
 */
export default function MeetingScreen() {
    const { token } = useLocalSearchParams(); // URL'deki :token
    const router = useRouter();
    const webRef = useRef(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    // WebView'in açacağı tam adres: visitor uygulamasının /v/:token rotası
    const url = `${VISITOR_URL}/v/${token}`;

    return (
        <View style={s.container}>
            <StatusBar style="light" />

            {/* Üst bar — geri / kapat butonu (WebView tam ekran olduğu için lazım) */}
            <View style={s.topBar}>
                <Pressable onPress={() => router.replace('/')} hitSlop={12}>
                    <Text style={s.leave}>✕  Leave</Text>
                </Pressable>
                <Text style={s.title}>AI Sales Rep</Text>
                <View style={{ width: 60 }} />
            </View>

            {/* Hata durumu */}
            {error ? (
                <View style={s.center}>
                    <Text style={s.errorText}>Could not load the meeting.</Text>
                    <Text style={s.errorHint}>
                        Web visitor uygulaması çalışıyor mu? ({url})
                    </Text>
                    <Pressable
                        style={s.retryBtn}
                        onPress={() => { setError(false); setLoading(true); webRef.current?.reload(); }}
                    >
                        <Text style={s.retryText}>Try again</Text>
                    </Pressable>
                </View>
            ) : (
                <WebView
                    ref={webRef}
                    source={{ uri: url }}
                    style={s.web}
                    // ── Mikrofon / WebRTC için kritik ayarlar ──
                    // Video/ses otomatik başlasın (kullanıcı tıklaması beklemesin)
                    mediaPlaybackRequiresUserAction={false}
                    allowsInlineMediaPlayback
                    // Android: getUserMedia izin isteğini otomatik onayla
                    // (Expo Go'nun kendi mikrofon izni zaten alınmış oluyor)
                    mediaCapturePermissionGrantType="grant"
                    // JS + storage açık olsun (LiveKit token vs. için)
                    javaScriptEnabled
                    domStorageEnabled
                    originWhitelist={['*']}
                    onLoadEnd={() => setLoading(false)}
                    onError={() => { setError(true); setLoading(false); }}
                    onHttpError={() => { setError(true); setLoading(false); }}
                />
            )}

            {/* Yükleniyor spinner'ı — WebView yüklenene kadar üstte */}
            {loading && !error ? (
                <View style={s.loadingOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color="#6d5efc" />
                    <Text style={s.loadingText}>Connecting to your AI rep…</Text>
                </View>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0b12' },

    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 56 : 16,
        paddingBottom: 12,
        backgroundColor: '#0b0b12',
    },
    leave: { color: '#ff5c5c', fontSize: 15, fontWeight: '600', width: 60 },
    title: { color: '#f5f5fa', fontSize: 16, fontWeight: '700' },

    web: { flex: 1, backgroundColor: '#0b0b12' },

    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0b0b12',
    },
    loadingText: { color: '#888', marginTop: 16, fontSize: 15 },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    errorText: { color: '#ff5c5c', fontSize: 17, fontWeight: '600', marginBottom: 8 },
    errorHint: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 24 },
    retryBtn: { backgroundColor: '#6d5efc', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 10 },
    retryText: { color: '#fff', fontWeight: '700' },
});
