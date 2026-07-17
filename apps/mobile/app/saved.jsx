import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Switch } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getSavedConversations, removeSavedConversation } from '../src/savedConversations';
import { requestPushPermission, getNotificationPref, setNotificationPref } from '../src/push';

function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function SavedScreen() {
    const router = useRouter();
    const [conversations, setConversations] = useState([]);
    const [notificationsOn, setNotificationsOn] = useState(false);

    useFocusEffect(
        useCallback(() => {
            getSavedConversations().then(setConversations);
            getNotificationPref().then(setNotificationsOn);
        }, [])
    );

    async function onToggleNotifications(value) {
        if (value) {
            const { granted } = await requestPushPermission();
            setNotificationsOn(granted);
        } else {
            await setNotificationPref(false);
            setNotificationsOn(false);
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
                            onPress={() => router.push(`/v/${item.token}`)}
                        >
                            <Text style={styles.resumeText}>Devam et</Text>
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
