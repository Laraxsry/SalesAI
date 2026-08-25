import { useCallback, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getSavedConversations } from '../src/savedConversations';
import { COLORS, FONT, SHADOWS } from '../src/theme';

/** Mobile visitor landing. Users join with an agent token or share link. */
export default function Home() {
    const router = useRouter();
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const [savedCount, setSavedCount] = useState(0);

    useFocusEffect(
        useCallback(() => {
            getSavedConversations().then((list) => setSavedCount(list.length));
        }, [])
    );

    const handleConnect = (overrideToken) => {
        let token = (typeof overrideToken === 'string' ? overrideToken : input).trim();
        if (!token) {
            setError('Paylaşım bağlantısını veya erişim kodunu girin.');
            return;
        }

        setError('');
        const tokenMatch = token.match(/(?:v\/|v=)([a-zA-Z0-9_-]+)/) || token.match(/\/v\/([a-zA-Z0-9_-]+)/);
        if (tokenMatch?.[1]) token = tokenMatch[1];

        if (!/^[a-zA-Z0-9_-]+$/.test(token)) {
            setError('Paylaşım bağlantısı veya erişim kodu formatı geçersiz.');
            return;
        }

        router.push(`/v/${encodeURIComponent(token)}`);
    };

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.screen}>
            <StatusBar style="light" />
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.hero}>
                    <View style={styles.orbitOne} />
                    <View style={styles.orbitTwo} />

                    <View style={styles.brandRow}>
                        <Text style={styles.brand}>Sales<Text style={styles.brandAccent}>AI</Text></Text>
                        <View style={styles.securePill}>
                            <View style={styles.liveDot} />
                            <Text style={styles.secureText}>GÜVENLİ</Text>
                        </View>
                    </View>

                    <View style={styles.heroCopy}>
                        <Text style={styles.eyebrow}>YAPAY ZEKA İLE CANLI GÖRÜŞME</Text>
                        <Text style={styles.heroTitle}>Doğru cevaba,{`\n`}daha hızlı ulaşın.</Text>
                        <Text style={styles.heroDescription}>
                            Sorularınızı sorun, ürünü canlı görün ve ihtiyacınız olan desteği anında alın.
                        </Text>
                    </View>
                </View>

                <View style={styles.joinCard}>
                    <View style={styles.cardHeadingRow}>
                        <View style={styles.cardIcon}>
                            <Ionicons name="sparkles-outline" size={19} color={COLORS.tealDark} />
                        </View>
                        <View style={styles.cardHeadingCopy}>
                            <Text style={styles.cardTitle}>Görüşmeye katılın</Text>
                            <Text style={styles.cardSubtitle}>Davet bağlantınızı veya erişim kodunuzu kullanın.</Text>
                        </View>
                    </View>

                    <Text style={styles.inputLabel}>ERİŞİM KODU</Text>
                    <View style={[styles.inputShell, error ? styles.inputShellError : null]}>
                        <Ionicons name="link-outline" size={19} color={COLORS.muted} />
                        <TextInput
                            style={styles.input}
                            placeholder="Bağlantı veya kod"
                            placeholderTextColor={COLORS.soft}
                            value={input}
                            onChangeText={(text) => {
                                setInput(text);
                                if (error) setError('');
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="go"
                            onSubmitEditing={() => handleConnect()}
                        />
                    </View>
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}

                    <TouchableOpacity style={styles.primaryButton} onPress={() => handleConnect()} activeOpacity={0.88}>
                        <Text style={styles.primaryButtonText}>Temsilciye bağlan</Text>
                        <View style={styles.primaryButtonIcon}>
                            <Ionicons name="arrow-forward" size={17} color={COLORS.ink} />
                        </View>
                    </TouchableOpacity>

                    <View style={styles.assuranceRow}>
                        <View style={styles.assuranceItem}>
                            <Ionicons name="mic-outline" size={15} color={COLORS.tealDark} />
                            <Text style={styles.assuranceText}>Sesli görüşme</Text>
                        </View>
                        <View style={styles.assuranceDivider} />
                        <View style={styles.assuranceItem}>
                            <Ionicons name="shield-checkmark-outline" size={15} color={COLORS.tealDark} />
                            <Text style={styles.assuranceText}>Şifreli bağlantı</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.quickActions}>
                    {savedCount > 0 && (
                        <TouchableOpacity style={styles.secondaryAction} onPress={() => router.push('/saved')} activeOpacity={0.75}>
                            <View style={styles.secondaryActionIcon}>
                                <Ionicons name="time-outline" size={19} color={COLORS.text} />
                            </View>
                            <View style={styles.secondaryActionCopy}>
                                <Text style={styles.secondaryActionTitle}>Geçmiş görüşmeler</Text>
                                <Text style={styles.secondaryActionText}>{savedCount} kayıtlı görüşme</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={COLORS.soft} />
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity style={styles.sellerLink} onPress={() => router.push('/console')} activeOpacity={0.75}>
                        <Ionicons name="business-outline" size={16} color={COLORS.muted} />
                        <Text style={styles.sellerLinkText}>Satıcı mısınız? Yönetim konsoluna girin</Text>
                        <Ionicons name="arrow-forward" size={15} color={COLORS.muted} />
                    </TouchableOpacity>
                </View>

                <Text style={styles.footer}>SalesAI · Akıllı satış görüşmeleri</Text>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: COLORS.canvas },
    scrollContent: { flexGrow: 1, paddingBottom: 28 },
    hero: {
        minHeight: 392,
        overflow: 'hidden',
        backgroundColor: COLORS.ink,
        paddingTop: Platform.OS === 'ios' ? 64 : 38,
        paddingHorizontal: 22,
        paddingBottom: 92,
    },
    orbitOne: {
        position: 'absolute',
        width: 280,
        height: 280,
        borderRadius: 140,
        borderWidth: 42,
        borderColor: 'rgba(215,249,91,0.055)',
        right: -118,
        top: 86,
    },
    orbitTwo: {
        position: 'absolute',
        width: 190,
        height: 190,
        borderRadius: 95,
        backgroundColor: 'rgba(20,184,166,0.08)',
        left: -110,
        top: -68,
    },
    brandRow: { flexDirection: 'row', alignItems: 'center' },
    brand: { color: COLORS.white, fontFamily: FONT.bold, fontSize: 19, letterSpacing: -0.5 },
    brandAccent: { color: COLORS.lime },
    securePill: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.05)',
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.lime },
    secureText: { color: 'rgba(255,255,255,0.65)', fontFamily: FONT.bold, fontSize: 9, letterSpacing: 1 },
    heroCopy: { marginTop: 62, maxWidth: 340 },
    eyebrow: { color: COLORS.lime, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 1.7 },
    heroTitle: { marginTop: 13, color: COLORS.white, fontFamily: FONT.bold, fontSize: 38, lineHeight: 43, letterSpacing: -1.6 },
    heroDescription: { marginTop: 15, maxWidth: 315, color: 'rgba(255,255,255,0.58)', fontFamily: FONT.regular, fontSize: 15, lineHeight: 23 },
    joinCard: {
        marginTop: -58,
        marginHorizontal: 18,
        borderRadius: 25,
        backgroundColor: COLORS.surface,
        padding: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.9)',
        ...SHADOWS.card,
    },
    cardHeadingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 23 },
    cardIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F6F2' },
    cardHeadingCopy: { flex: 1, marginLeft: 12 },
    cardTitle: { color: COLORS.text, fontFamily: FONT.bold, fontSize: 18, letterSpacing: -0.35 },
    cardSubtitle: { marginTop: 3, color: COLORS.muted, fontFamily: FONT.regular, fontSize: 12.5, lineHeight: 18 },
    inputLabel: { marginBottom: 8, color: COLORS.muted, fontFamily: FONT.bold, fontSize: 9, letterSpacing: 1.5 },
    inputShell: {
        minHeight: 54,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: COLORS.line,
        backgroundColor: '#F7F9F7',
        paddingHorizontal: 15,
    },
    inputShellError: { borderColor: COLORS.danger, backgroundColor: '#FFF8F7' },
    input: { flex: 1, color: COLORS.text, fontFamily: FONT.medium, fontSize: 15, paddingVertical: 14 },
    errorText: { marginTop: 8, color: COLORS.danger, fontFamily: FONT.medium, fontSize: 12, lineHeight: 17 },
    primaryButton: {
        minHeight: 55,
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 16,
        backgroundColor: COLORS.ink,
        paddingHorizontal: 8,
        ...SHADOWS.button,
    },
    primaryButtonText: { color: COLORS.white, fontFamily: FONT.bold, fontSize: 15 },
    primaryButtonIcon: {
        position: 'absolute',
        right: 8,
        width: 39,
        height: 39,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: COLORS.lime,
    },
    assuranceRow: { marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    assuranceItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    assuranceText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 10.5 },
    assuranceDivider: { width: 1, height: 14, marginHorizontal: 13, backgroundColor: COLORS.line },
    quickActions: { marginHorizontal: 18, marginTop: 18 },
    secondaryAction: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.line,
        backgroundColor: 'rgba(255,255,255,0.68)',
        padding: 14,
    },
    secondaryActionIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: COLORS.surfaceMuted },
    secondaryActionCopy: { flex: 1, marginLeft: 11 },
    secondaryActionTitle: { color: COLORS.text, fontFamily: FONT.bold, fontSize: 13 },
    secondaryActionText: { marginTop: 2, color: COLORS.muted, fontFamily: FONT.regular, fontSize: 11 },
    sellerLink: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12 },
    sellerLinkText: { color: COLORS.muted, fontFamily: FONT.medium, fontSize: 11.5 },
    footer: { marginTop: 'auto', paddingTop: 20, textAlign: 'center', color: COLORS.soft, fontFamily: FONT.medium, fontSize: 10.5 },
});
