import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../_layout';
import { CONFIG } from '../../../config';

export default function SessionMonitorScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { token } = useAuth();
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
            const res = await fetch(`${CONFIG.API_URL}/api/v1/sessions/${id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
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
            const res = await fetch(`${CONFIG.API_URL}/api/v1/sessions/${id}/transcript`);
            if (!res.ok) throw new Error('Failed to load transcripts');
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
            const res = await fetch(`${CONFIG.API_URL}/api/v1/sessions/${id}/summary`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
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

        // Polling interval if session is live
        const interval = setInterval(() => {
            fetchSessionDetails();
            fetchMessages(false);
            fetchSummary();
        }, 3000);

        return () => clearInterval(interval);
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
                <Text style={styles.loadingText}>Connecting to session transcripts...</Text>
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
                    <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle} numberOfLines={1}>
                        {session?.visitorName || 'Visitor'}
                    </Text>
                    <Text style={styles.headerSubtitle}>
                        Room: {session?.roomName || 's_...'}
                    </Text>
                </View>
                <View style={[styles.statusBadge, isLive ? styles.badgeLive : styles.badgeEnded]}>
                    <Text style={[styles.badgeText, isLive ? styles.badgeLiveText : styles.badgeEndedText]}>
                        {isLive ? 'LIVE' : 'ENDED'}
                    </Text>
                </View>
            </View>

            {/* View Mode Toggle (Transcript vs AI Summary) */}
            <View style={styles.toggleContainer}>
                <TouchableOpacity 
                    style={[styles.toggleBtn, viewMode === 'transcript' && styles.toggleBtnActive]}
                    onPress={() => setViewMode('transcript')}
                >
                    <Text style={[styles.toggleBtnText, viewMode === 'transcript' && styles.toggleBtnActiveText]}>Transcript</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                    style={[styles.toggleBtn, viewMode === 'summary' && styles.toggleBtnActive]}
                    onPress={() => setViewMode('summary')}
                >
                    <Text style={[styles.toggleBtnText, viewMode === 'summary' && styles.toggleBtnActiveText]}>AI Post-Call Summary</Text>
                </TouchableOpacity>
            </View>

            {/* LIVE monitoring toast indicator */}
            {isLive && viewMode === 'transcript' && (
                <View style={styles.liveBanner}>
                    <View style={styles.pulseDot} />
                    <Text style={styles.liveBannerText}>Real-time monitoring active. Polling logs...</Text>
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
                                        {isAssistant ? 'AI Agent' : 'Customer'}
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
                            <Text style={styles.emptyText}>Waiting for conversation to begin...</Text>
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
                            <Text style={styles.summaryLabel}>TL;DR Summary</Text>
                            <Text style={styles.summaryTextValue}>{summary.tldr || 'No summary generated yet.'}</Text>

                            <Text style={styles.summaryLabel}>Topics Discussed</Text>
                            <View style={styles.chipsRow}>
                                {(summary.topics || []).map((t, index) => (
                                    <View key={index} style={styles.chip}>
                                        <Text style={styles.chipText}>{t}</Text>
                                    </View>
                                ))}
                                {(!summary.topics || summary.topics.length === 0) && (
                                    <Text style={styles.noDataText}>None</Text>
                                )}
                            </View>

                            <Text style={styles.summaryLabel}>Customer Objections</Text>
                            <View style={styles.chipsRow}>
                                {(summary.objections || []).map((o, index) => (
                                    <View key={index} style={[styles.chip, { backgroundColor: 'rgba(248, 113, 113, 0.15)' }]}>
                                        <Text style={[styles.chipText, { color: '#f87171' }]}>{o}</Text>
                                    </View>
                                ))}
                                {(!summary.objections || summary.objections.length === 0) && (
                                    <Text style={styles.noDataText}>None</Text>
                                )}
                            </View>

                            <Text style={styles.summaryLabel}>Unanswered Questions</Text>
                            <View style={styles.unansweredList}>
                                {(summary.unanswered || []).map((q, index) => (
                                    <Text key={index} style={styles.unansweredItem}>• {q}</Text>
                                ))}
                                {(!summary.unanswered || summary.unanswered.length === 0) && (
                                    <Text style={styles.noDataText}>None</Text>
                                )}
                            </View>

                            <Text style={styles.summaryLabel}>Next Recommended Step</Text>
                            <Text style={styles.nextStepText}>{summary.nextStep || 'Follow up with details'}</Text>
                        </View>
                    ) : (
                        <View style={styles.emptyContainer}>
                            {isLive ? (
                                <ActivityIndicator size="small" color="#6d5efc" style={{ marginBottom: 12 }} />
                            ) : null}
                            <Text style={styles.emptyText}>
                                {isLive ? 'Görüşme hala devam ediyor. Sonlandığında analiz raporu oluşturulacaktır.' : 'Analiz raporu henüz oluşturulmadı.'}
                            </Text>
                        </View>
                    )}
                </ScrollView>
            )}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0b12',
    },
    centerContainer: {
        flex: 1,
        backgroundColor: '#0b0b12',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    loadingText: {
        color: '#9ba1b0',
        fontSize: 16,
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
        borderColor: '#1e1e2f',
        backgroundColor: '#10101a',
    },
    backButton: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: '#1b1b2a',
        borderWidth: 1,
        borderColor: '#2d2d44',
    },
    backButtonText: {
        color: '#9ba1b0',
        fontSize: 14,
        fontWeight: '600',
    },
    headerTitleContainer: {
        flex: 1,
        marginHorizontal: 12,
    },
    headerTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '700',
    },
    headerSubtitle: {
        color: '#6c727f',
        fontSize: 12,
        marginTop: 1,
    },
    statusBadge: {
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 12,
    },
    badgeLive: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
    },
    badgeEnded: {
        backgroundColor: 'rgba(108, 114, 127, 0.15)',
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '800',
    },
    badgeLiveText: {
        color: '#10b981',
    },
    badgeEndedText: {
        color: '#9ba1b0',
    },
    toggleContainer: {
        flexDirection: 'row',
        backgroundColor: '#10101a',
        padding: 6,
        borderBottomWidth: 1,
        borderColor: '#1e1e2f',
    },
    toggleBtn: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 8,
    },
    toggleBtnActive: {
        backgroundColor: '#6d5efc',
    },
    toggleBtnText: {
        color: '#9ba1b0',
        fontSize: 13,
        fontWeight: '600',
    },
    toggleBtnActiveText: {
        color: '#ffffff',
    },
    liveBanner: {
        backgroundColor: 'rgba(109, 94, 252, 0.15)',
        borderBottomWidth: 1,
        borderColor: 'rgba(109, 94, 252, 0.3)',
        paddingVertical: 8,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pulseDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#10b981',
        marginRight: 8,
    },
    liveBannerText: {
        color: '#6d5efc',
        fontSize: 12,
        fontWeight: '600',
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
        maxWidth: '80%',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    bubbleUser: {
        backgroundColor: '#1b1b2a',
        borderBottomLeftRadius: 4,
        borderWidth: 1,
        borderColor: '#2d2d44',
    },
    bubbleAssistant: {
        backgroundColor: '#6d5efc',
        borderBottomRightRadius: 4,
    },
    bubbleRole: {
        fontSize: 11,
        fontWeight: '700',
        marginBottom: 4,
        color: '#9ba1b0',
    },
    bubbleText: {
        color: '#ffffff',
        fontSize: 15,
        lineHeight: 22,
    },
    bubbleTime: {
        alignSelf: 'flex-end',
        fontSize: 10,
        color: 'rgba(255, 255, 255, 0.5)',
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
        backgroundColor: '#1e1e2f',
    },
    systemText: {
        color: '#6c727f',
        fontSize: 12,
        fontWeight: '600',
        marginHorizontal: 10,
        textAlign: 'center',
    },
    errorContainer: {
        padding: 24,
        alignItems: 'center',
    },
    errorText: {
        color: '#f87171',
        fontSize: 15,
        textAlign: 'center',
    },
    emptyContainer: {
        paddingVertical: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        color: '#4e5564',
        fontSize: 14,
        textAlign: 'center',
    },
    summaryCard: {
        backgroundColor: '#13131e',
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
        borderColor: '#242436',
    },
    summaryLabel: {
        color: '#6d5efc',
        fontSize: 14,
        fontWeight: '700',
        marginTop: 20,
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    summaryTextValue: {
        color: '#ffffff',
        fontSize: 15,
        lineHeight: 22,
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        backgroundColor: 'rgba(109, 94, 252, 0.15)',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 12,
    },
    chipText: {
        color: '#6d5efc',
        fontSize: 12,
        fontWeight: '600',
    },
    noDataText: {
        color: '#4e5564',
        fontSize: 14,
        fontStyle: 'italic',
    },
    unansweredList: {
        gap: 6,
    },
    unansweredItem: {
        color: '#ffffff',
        fontSize: 14,
        lineHeight: 20,
    },
    nextStepText: {
        color: '#10b981',
        fontSize: 14,
        fontWeight: '600',
    },
});
