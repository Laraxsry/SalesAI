import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CONFIG } from '../../config';
import { getVisitorAuth } from '../../src/visitorIdentity';
import { useAppTheme } from '../../src/theme-context';

export default function SavedConversationScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { colors, isDark } = useAppTheme();
    const styles = createStyles(colors);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const { accessToken } = await getVisitorAuth();
                if (!accessToken) throw new Error('Görüşme geçmişini görmek için e-posta senkronizasyonu gerekli.');
                const res = await fetch(`${CONFIG.API_URL}/api/v1/sessions/${id}/transcript`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                const data = await res.json().catch(() => []);
                if (!res.ok) throw new Error('Görüşme yüklenemedi.');
                if (active) setMessages(data);
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, [id]);

    return (
        <View style={styles.container}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityLabel="Geri dön">
                    <Text style={styles.back}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Görüşme Detayı</Text>
                <View style={styles.headerSpacer} />
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator size="large" color={colors.teal} /></View>
            ) : error ? (
                <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
            ) : (
                <FlatList
                    data={messages}
                    keyExtractor={(item, index) => item._id || `${item.at || 'message'}-${index}`}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={<Text style={styles.empty}>Bu görüşme için henüz transkript yok.</Text>}
                    renderItem={({ item }) => (
                        <View style={[styles.message, item.role === 'assistant' ? styles.assistant : styles.visitor]}>
                            <Text style={[styles.role, item.role !== 'assistant' && styles.visitorRole]}>{item.role === 'assistant' ? 'SalesAI' : 'Ziyaretçi'}</Text>
                            <Text style={[styles.messageText, item.role !== 'assistant' && styles.visitorMessageText]}>{item.text}</Text>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const createStyles = (colors) => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.canvas },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16 },
    back: { color: colors.text, fontSize: 32, lineHeight: 32 },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' },
    headerSpacer: { width: 24 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
    error: { color: colors.danger, textAlign: 'center', lineHeight: 21 },
    list: { padding: 20, gap: 12 },
    empty: { color: colors.muted, textAlign: 'center', marginTop: 60 },
    message: { maxWidth: '88%', borderRadius: 16, padding: 14 },
    assistant: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
    visitor: { alignSelf: 'flex-end', backgroundColor: colors.tealDark },
    role: { color: colors.teal, fontSize: 11, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
    visitorRole: { color: 'rgba(255,255,255,0.72)' },
    messageText: { color: colors.text, fontSize: 15, lineHeight: 21 },
    visitorMessageText: { color: colors.white },
});
