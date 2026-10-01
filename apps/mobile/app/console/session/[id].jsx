import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { io } from 'socket.io-client';
import { useAuth } from '../_layout';
import { CONFIG } from '../../../config';
import { useAppTheme } from '../../../src/theme-context';
import { FONT } from '../../../src/theme';

// Session status can't change without a page-visible action (agent-worker
// isn't wired to publish session:started/ended over Socket.IO yet — only
// session:transcript and session:summary are), so this is a low-frequency
// fallback just to notice a live call ending, not the transcript's source of truth.
const STATUS_POLL_MS = 8000;

export default function SessionMonitorScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { token, apiFetch } = useAuth();
    const { colors, isDark } = useAppTheme();
    const styles = createStyles(colors, isDark);
    const flatListRef = useRef(null);

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState(null);
    const [messages, setMessages] = useState([]);
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState('');
    const [viewMode, setViewMode] = useState('transcript'); // transcript, summary

    const fetchSessionDetails = async () => {
        if (!token) return;
        try {
            const res = await apiFetch(`/api/v1/sessions/${id}`);
            if (res.ok) {
                const data = await res.json();
                setSession(data);
            }
        } catch (err) {
            console.error('Error fetching session details:', err);
        }
    };

    const fetchMessages = async (initial = false) => {
        if (!token) return;
        try {
            // Using public route for transcripts
            const res = await apiFetch(`/api/v1/sessions/${id}/transcript`);
            if (!res.ok) throw new Error('Görüşme dökümü yüklenemedi.');
            const data = await res.json();
            setMessages(data);
            if (initial) setLoading(false);
        } catch (err) {
            console.error('Error fetching messages:', err);
            if (initial) {
                setError(err.message);
                setLoading(false);
            }
        }
    };

    const fetchSummary = async () => {
        if (!token) return;
        try {
            const res = await apiFetch(`/api/v1/sessions/${id}/summary`);
            if (res.ok) {
                const data = await res.json();
                setSummary(data);
            }
        } catch (err) {
            console.error('Error fetching summary:', err);
        }
    };

    useEffect(() => {
        if (!token) {
            router.replace('/console');
            return;
        }

        // Initial fetch
        fetchSessionDetails();
        fetchMessages(true);
        fetchSummary();

        // Real-time updates: same Socket.IO gateway the web console already
        // uses (packages/realtime) — agent-worker/worker-general publish
        // session:transcript per message and session:summary once analysis
        // finishes, so we append/refetch instead of polling for them.
        const socket = io(CONFIG.API_URL, { transports: ['websocket'] });

        socket.on('session:transcript', (payload) => {
            if (payload.sessionId !== id) return;
            setMessages((prev) =>
                prev.some((m) => m._id === payload.messageId)
                    ? prev
                    : [...prev, { _id: payload.messageId, role: payload.role, text: payload.text, at: payload.createdAt }]
            );
        });

        socket.on('session:summary', (payload) => {
            if (payload.sessionId !== id) return;
            fetchSummary();
            fetchSessionDetails(); // summary lands right after the session ends
        });

        // Low-frequency fallback for the live→ended transition (no
        // session:started/ended event exists yet — see STATUS_POLL_MS above).
        const statusInterval = setInterval(fetchSessionDetails, STATUS_POLL_MS);

        return () => {
            socket.disconnect();
            clearInterval(statusInterval);
        };
    }, [id, token]);

    // Scroll to bottom when messages list updates
    useEffect(() => {
        if (messages.length > 0 && flatListRef.current && viewMode === 'transcript') {
            setTimeout(() => {
                flatListRef.current.scrollToEnd({ animated: true });
            }, 100);
        }
    }, [messages, viewMode]);

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#6d5efc" />
                <Text style={styles.loadingText}>Görüşme dökümü yükleniyor…</Text>
            </View>
        );
    }

    const isLive = session?.status === 'live';

    return (
        <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
            style={styles.container}
        >
            <StatusBar style="light" />

            {/* Header info */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
                    <Text style={styles.backButtonText}>← Geri</Text>
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle} numberOfLines={1}>
                        {session?.visitorName || 'Ziyaretçi'}
                    </Text>
                    <Text style={styles.headerSubtitle}>
                        Oda: {session?.roomName || 's_...'}
                    </Text>
                </View>
                <View style={[styles.statusBadge, isLive ? styles.badgeLive : styles.badgeEnded]}>
                    <Text style={[styles.badgeText, isLive ? styles.badgeLiveText : styles.badgeEndedText]}>
                        {isLive ? 'CANLI' : 'SONLANDI'}
                    </Text>
                </View>
            </View>

            {/* View Mode Toggle (Transcript vs AI Summary) */}
            <View style={styles.toggleContainer}>
                <TouchableOpacity 
                    style={[styles.toggleBtn, viewMode === 'transcript' && styles.toggleBtnActive]}
                    onPress={() => setViewMode('transcript')}
                >
                    <Text style={[styles.toggleBtnText, viewMode === 'transcript' && styles.toggleBtnActiveText]}>Görüşme Dökümü</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                    style={[styles.toggleBtn, viewMode === 'summary' && styles.toggleBtnActive]}
                    onPress={() => setViewMode('summary')}
                >
                    <Text style={[styles.toggleBtnText, viewMode === 'summary' && styles.toggleBtnActiveText]}>AI Görüşme Özeti</Text>
                </TouchableOpacity>
            </View>

            {/* LIVE monitoring toast indicator */}
            {isLive && viewMode === 'transcript' && (
                <View style={styles.liveBanner}>
                    <View style={styles.pulseDot} />
                    <Text style={styles.liveBannerText}>Canlı izleme etkin</Text>
                </View>
            )}

            {error ? (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            ) : viewMode === 'transcript' ? (
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={(item) => item._id}
                    renderItem={({ item }) => {
                        const isAssistant = item.role === 'assistant';
                        const isSystem = item.role === 'system';

                        if (isSystem) {
                            return (
                                <View style={styles.systemMessageContainer}>
                                    <View style={styles.systemDivider} />
                                    <Text style={styles.systemText}>{item.text}</Text>
                                    <View style={styles.systemDivider} />
                                </View>
                            );
                        }

                        return (
                            <View style={[styles.messageRow, isAssistant ? styles.rowAssistant : styles.rowUser]}>
                                <View style={[styles.bubble, isAssistant ? styles.bubbleAssistant : styles.bubbleUser]}>
                                    <Text style={styles.bubbleRole}>
                                        {isAssistant ? 'AI Temsilcisi' : 'Müşteri'}
                                    </Text>
                                    <Text style={styles.bubbleText}>{item.text}</Text>
                                    {item.at && (
                                        <Text style={styles.bubbleTime}>
                                            {new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </Text>
                                    )}
                                </View>
                            </View>
                        );
                    }}
                    ListEmptyComponent={() => (
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>Görüşmenin başlaması bekleniyor…</Text>
                        </View>
                    )}
                    contentContainerStyle={styles.listContent}
                    onContentSizeChange={() => {
                        if (messages.length > 0 && flatListRef.current && viewMode === 'transcript') {
                            flatListRef.current.scrollToEnd({ animated: true });
                        }
                    }}
                />
            ) : (
                <ScrollView contentContainerStyle={styles.summaryScrollContent}>
                    {summary ? (
                        <View style={styles.summaryCard}>
                            <Text style={styles.summaryLabel}>Kısa Özet</Text>
                            <Text style={styles.summaryTextValue}>{summary.tldr || 'Henüz özet oluşturulmadı.'}</Text>

                            <Text style={styles.summaryLabel}>Konuşulan Konular</Text>
                            <View style={styles.chipsRow}>
                                {(summary.topics || []).map((t, index) => (
                                    <View key={index} style={styles.chip}>
                                        <Text style={styles.chipText}>{t}</Text>
                                    </View>
                                ))}
                                {(!summary.topics || summary.topics.length === 0) && (
                                    <Text style={styles.noDataText}>Yok</Text>
                                )}
                            </View>

                            <Text style={styles.summaryLabel}>Müşteri İtirazları</Text>
                            <View style={styles.chipsRow}>
                                {(summary.objections || []).map((o, index) => (
                                    <View key={index} style={[styles.chip, { backgroundColor: 'rgba(248, 113, 113, 0.15)' }]}>
                                        <Text style={[styles.chipText, { color: '#f87171' }]}>{o}</Text>
                                    </View>
                                ))}
                                {(!summary.objections || summary.objections.length === 0) && (
                                    <Text style={styles.noDataText}>Yok</Text>
                                )}
                            </View>

                            <Text style={styles.summaryLabel}>Yanıtsız Sorular</Text>
                            <View style={styles.unansweredList}>
                                {(summary.unanswered || []).map((q, index) => (
                                    <Text key={index} style={styles.unansweredItem}>• {q}</Text>
                                ))}
                                {(!summary.unanswered || summary.unanswered.length === 0) && (
                                    <Text style={styles.noDataText}>Yok</Text>
                                )}
                            </View>

                            <Text style={styles.summaryLabel}>Önerilen Sonraki Adım</Text>
                            <Text style={styles.nextStepText}>{summary.nextStep || 'Ayrıntılarla takip edin'}</Text>
                        </View>
                    ) : (
                        <View style={styles.emptyContainer}>
                            {isLive ? (
                                <ActivityIndicator size="small" color="#6d5efc" style={{ marginBottom: 12 }} />
                            ) : null}
                            <Text style={styles.emptyText}>
                                {isLive ? 'Görüşme hâlâ devam ediyor. Sonlandığında analiz raporu oluşturulacaktır.' : 'Analiz raporu henüz oluşturulmadı.'}
                            </Text>
                        </View>
                    )}
                </ScrollView>
            )}
        </KeyboardAvoidingView>
    );
}

const createStyles = (colors, isDark) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.canvas,
    },
    centerContainer: {
        flex: 1,
        backgroundColor: colors.canvas,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    loadingText: {
        color: colors.muted,
        fontFamily: FONT.medium,
        fontSize: 15,
        marginTop: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
    },
    backButton: {
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.line,
    },
    backButtonText: {
        color: colors.text,
        fontFamily: FONT.bold,
        fontSize: 13,
    },
    headerTitleContainer: {
        flex: 1,
        marginHorizontal: 12,
    },
    headerTitle: {
        color: colors.text,
        fontFamily: FONT.bold,
        fontSize: 17,
    },
    headerSubtitle: {
        color: colors.muted,
        fontFamily: FONT.medium,
        fontSize: 11.5,
        marginTop: 1,
    },
    statusBadge: {
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 12,
    },
    badgeLive: {
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
    },
    badgeEnded: {
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(100, 116, 139, 0.12)',
    },
    badgeText: {
        fontSize: 10.5,
        fontFamily: FONT.bold,
        letterSpacing: 0.5,
    },
    badgeLiveText: {
        color: colors.lime,
    },
    badgeEndedText: {
        color: colors.muted,
    },
    toggleContainer: {
        flexDirection: 'row',
        backgroundColor: colors.surfaceMuted,
        padding: 4,
        marginHorizontal: 20,
        marginVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.line,
    },
    toggleBtn: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 9,
    },
    toggleBtnActive: {
        backgroundColor: colors.surface,
        shadowColor: colors.ink,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    toggleBtnText: {
        color: colors.muted,
        fontFamily: FONT.medium,
        fontSize: 13,
    },
    toggleBtnActiveText: {
        color: colors.text,
        fontFamily: FONT.bold,
    },
    liveBanner: {
        backgroundColor: 'rgba(37, 99, 235, 0.12)',
        borderBottomWidth: 1,
        borderColor: 'rgba(37, 99, 235, 0.25)',
        paddingVertical: 8,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pulseDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: colors.lime,
        marginRight: 8,
    },
    liveBannerText: {
        color: colors.teal,
        fontFamily: FONT.bold,
        fontSize: 12,
    },
    listContent: {
        padding: 20,
        paddingBottom: 40,
    },
    summaryScrollContent: {
        padding: 20,
        paddingBottom: 40,
    },
    messageRow: {
        flexDirection: 'row',
        marginBottom: 16,
        width: '100%',
    },
    rowUser: {
        justifyContent: 'flex-start',
    },
    rowAssistant: {
        justifyContent: 'flex-end',
    },
    bubble: {
        maxWidth: '82%',
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    bubbleUser: {
        backgroundColor: colors.surface,
        borderBottomLeftRadius: 4,
        borderWidth: 1,
        borderColor: colors.line,
    },
    bubbleAssistant: {
        backgroundColor: colors.teal,
        borderBottomRightRadius: 4,
    },
    bubbleRole: {
        fontSize: 10.5,
        fontFamily: FONT.bold,
        marginBottom: 4,
        color: colors.muted,
        textTransform: 'uppercase',
    },
    bubbleText: {
        color: colors.text,
        fontFamily: FONT.regular,
        fontSize: 14.5,
        lineHeight: 21,
    },
    bubbleTime: {
        alignSelf: 'flex-end',
        fontSize: 9.5,
        color: colors.soft,
        marginTop: 4,
    },
    systemMessageContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 16,
        paddingHorizontal: 12,
    },
    systemDivider: {
        flex: 1,
        height: 1,
        backgroundColor: colors.line,
    },
    systemText: {
        color: colors.muted,
        fontFamily: FONT.medium,
        fontSize: 11.5,
        marginHorizontal: 10,
        textAlign: 'center',
    },
    errorContainer: {
        padding: 24,
        alignItems: 'center',
    },
    errorText: {
        color: colors.danger,
        fontFamily: FONT.medium,
        fontSize: 14,
        textAlign: 'center',
    },
    emptyContainer: {
        paddingVertical: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        color: colors.soft,
        fontFamily: FONT.regular,
        fontSize: 14,
        textAlign: 'center',
    },
    summaryCard: {
        backgroundColor: colors.surface,
        borderRadius: 18,
        padding: 20,
        borderWidth: 1,
        borderColor: colors.line,
    },
    summaryLabel: {
        color: colors.teal,
        fontFamily: FONT.bold,
        fontSize: 13,
        marginTop: 20,
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    summaryTextValue: {
        color: colors.text,
        fontFamily: FONT.regular,
        fontSize: 14.5,
        lineHeight: 22,
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(37, 99, 235, 0.08)',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: isDark ? 'rgba(59, 130, 246, 0.25)' : 'rgba(37, 99, 235, 0.15)',
    },
    chipText: {
        color: colors.teal,
        fontFamily: FONT.bold,
        fontSize: 12,
    },
    noDataText: {
        color: colors.soft,
        fontFamily: FONT.regular,
        fontSize: 13.5,
        fontStyle: 'italic',
    },
    unansweredList: {
        gap: 6,
    },
    unansweredItem: {
        color: colors.text,
        fontFamily: FONT.regular,
        fontSize: 14,
        lineHeight: 20,
    },
    nextStepText: {
        color: colors.lime,
        fontFamily: FONT.bold,
        fontSize: 14,
    },
});
