import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Switch, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getSavedConversations, removeSavedConversation } from '../src/savedConversations';
import { requestPushPermission, getNotificationPref, setNotificationPref } from '../src/push';
import { getVisitorAuth, requestMagicLink, verifyMagicLink } from '../src/visitorIdentity';

function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function SavedScreen() {
    const router = useRouter();
    const [conversations, setConversations] = useState([]);
    const [notificationsOn, setNotificationsOn] = useState(false);
    const [syncedEmail, setSyncedEmail] = useState(null);
    const [emailInput, setEmailInput] = useState('');
    const [tokenInput, setTokenInput] = useState('');
    const [linkRequested, setLinkRequested] = useState(false);
    const [syncBusy, setSyncBusy] = useState(false);
    const [syncError, setSyncError] = useState('');

    const refresh = useCallback(() => {
        getSavedConversations().then(setConversations);
        getNotificationPref().then(setNotificationsOn);
        getVisitorAuth().then((auth) => setSyncedEmail(auth.email || null));
    }, []);

    useFocusEffect(refresh);

    async function onToggleNotifications(value) {
        if (value) {
            const { granted, reason } = await requestPushPermission();
            setNotificationsOn(granted);
            if (!granted && reason === 'project-not-configured') {
                Alert.alert('Bildirimler hazır değil', 'EAS projectId tanımlandıktan sonra push bildirimleri etkinleştirilebilir.');
            } else if (!granted) {
                Alert.alert('Bildirimler açılamadı', 'Cihaz kaydı tamamlanamadı. Ağ bağlantını ve bildirim iznini kontrol et.');
            }
        } else {
            await setNotificationPref(false);
            setNotificationsOn(false);
        }
    }

    async function onRequestLink() {
        if (!emailInput.trim()) return;
        setSyncError('');
        setSyncBusy(true);
        try {
            await requestMagicLink(emailInput.trim());
            setLinkRequested(true);
        } catch (err) {
            setSyncError(err.message);
        } finally {
            setSyncBusy(false);
        }
    }

    async function onVerifyToken() {
        if (!tokenInput.trim()) return;
        setSyncError('');
        setSyncBusy(true);
        try {
            const data = await verifyMagicLink(tokenInput.trim());
            setSyncedEmail(data.email);
            setLinkRequested(false);
            setTokenInput('');
            refresh();
        } catch (err) {
            setSyncError(err.message);
        } finally {
            setSyncBusy(false);
        }
    }

    async function onRemove(id) {
        const next = await removeSavedConversation(id);
        setConversations(next);
    }

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
                    <Text style={styles.backArrow}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Kayıtlı Görüşmeler</Text>
                <View style={{ width: 24 }} />
            </View>

            <View style={styles.notifCard}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.notifTitle}>Bildirimler</Text>
                    <Text style={styles.notifDesc}>Takip mesajları ve agent müsaitliği için bildirim al.</Text>
                </View>
                <Switch
                    value={notificationsOn}
                    onValueChange={onToggleNotifications}
                    trackColor={{ false: '#2d2d44', true: '#6d5efc' }}
                    thumbColor="#ffffff"
                />
            </View>

            <View style={styles.notifCard}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.notifTitle}>Cihazlar arası senkronizasyon</Text>
                    {syncedEmail ? (
                        <Text style={styles.notifDesc}>{syncedEmail} ile senkronize edildi.</Text>
                    ) : (
                        <>
                            <Text style={styles.notifDesc}>
                                E-postanı gir, sana bir bağlantı gönderelim — görüşmelerin diğer cihazlarında da görünsün.
                            </Text>
                            <View style={styles.syncRow}>
                                <TextInput
                                    style={styles.syncInput}
                                    placeholder="ornek@eposta.com"
                                    placeholderTextColor="#6c727f"
                                    value={emailInput}
                                    onChangeText={setEmailInput}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                />
                                <TouchableOpacity style={styles.syncButton} onPress={onRequestLink} disabled={syncBusy}>
                                    {syncBusy ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.syncButtonText}>Gönder</Text>}
                                </TouchableOpacity>
                            </View>

                            {linkRequested && (
                                <View style={styles.syncRow}>
                                    <TextInput
                                        style={styles.syncInput}
                                        placeholder="Bağlantıdaki kodu yapıştır"
                                        placeholderTextColor="#6c727f"
                                        value={tokenInput}
                                        onChangeText={setTokenInput}
                                        autoCapitalize="none"
                                    />
                                    <TouchableOpacity style={styles.syncButton} onPress={onVerifyToken} disabled={syncBusy}>
                                        {syncBusy ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.syncButtonText}>Doğrula</Text>}
                                    </TouchableOpacity>
                                </View>
                            )}

                            {syncError ? <Text style={styles.syncError}>{syncError}</Text> : null}
                        </>
                    )}
                </View>
            </View>

            <FlatList
                data={conversations}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Text style={styles.emptyTitle}>Henüz kayıtlı görüşme yok</Text>
                        <Text style={styles.emptyDesc}>Bir görüşmeyi sonlandırdığında burada görünecek.</Text>
                    </View>
                }
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.cardTitle}>{item.agentName}</Text>
                            <Text style={styles.cardDate}>{formatDate(item.endedAt)}</Text>
                        </View>
                        <TouchableOpacity
                            style={styles.resumeButton}
                            onPress={() => router.push(item.remote ? `/saved/${item.sessionId}` : `/v/${item.token}`)}
                        >
                            <Text style={styles.resumeText}>{item.remote ? 'Detay' : 'Devam et'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => onRemove(item.id)} hitSlop={10} style={styles.removeButton}>
                            <Text style={styles.removeText}>✕</Text>
                        </TouchableOpacity>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0b12' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 60,
        paddingBottom: 16
    },
    backArrow: { color: '#ffffff', fontSize: 32, fontWeight: '300', lineHeight: 32 },
    title: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
    notifCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#13131e',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#242436',
        marginHorizontal: 20,
        padding: 16,
        marginBottom: 8
    },
    notifTitle: { color: '#ffffff', fontSize: 15, fontWeight: '600', marginBottom: 2 },
    notifDesc: { color: '#9ba1b0', fontSize: 12, lineHeight: 16 },
    syncRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    syncInput: {
        flex: 1,
        backgroundColor: '#1b1b2a',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#2d2d44',
        color: '#ffffff',
        fontSize: 13,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    syncButton: {
        backgroundColor: '#6d5efc',
        borderRadius: 10,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    syncButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
    syncError: { color: '#f87171', fontSize: 12, marginTop: 8 },
    listContent: { padding: 20, paddingBottom: 40 },
    empty: { alignItems: 'center', marginTop: 60 },
    emptyTitle: { color: '#ffffff', fontSize: 16, fontWeight: '600', marginBottom: 6 },
    emptyDesc: { color: '#6c727f', fontSize: 13, textAlign: 'center' },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#13131e',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#242436',
        padding: 14,
        marginBottom: 10
    },
    cardTitle: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
    cardDate: { color: '#6c727f', fontSize: 12, marginTop: 2 },
    resumeButton: {
        backgroundColor: '#6d5efc',
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 14,
        marginRight: 8
    },
    resumeText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
    removeButton: { padding: 4 },
    removeText: { color: '#6c727f', fontSize: 16 }
});
