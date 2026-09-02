import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, FlatList, RefreshControl, Switch, Platform, Alert, Linking, TextInput } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './_layout';
import { FONT } from '../../src/theme';
import { useAppTheme } from '../../src/theme-context';

const SESSION_STATUS_LABELS = {
    live: 'CANLI',
    ended: 'SONLANDI',
    active: 'AKTİF',
};

const AGENT_STATUS_LABELS = {
    active: 'AKTİF',
    paused: 'DURAKLATILDI',
};

const WORKSPACE_ROLE_LABELS = {
    OWNER: 'Sahip',
    ADMIN: 'Yönetici',
    EDITOR: 'Editör',
    MEMBER: 'Üye',
    VIEWER: 'Görüntüleyici',
};

const TONE_LABELS = {
    friendly: 'samimi',
    expert: 'uzman',
    consultative: 'danışman',
    persuasive: 'ikna edici',
    concise: 'öz',
    'outcome-focused': 'sonuç odaklı',
    confident: 'kendinden emin',
};

function formatTone(tone) {
    if (!tone) return 'Samimi';
    return tone
        .split(',')
        .map((part) => TONE_LABELS[part.trim().toLowerCase()] || part.trim())
        .join(', ');
}

export default function DashboardScreen() {
    const router = useRouter();
    const { token, user, logout, apiFetch } = useAuth();
    const { colors, isDark, toggleTheme } = useAppTheme();
    const styles = createStyles(colors, isDark);

    const [activeTab, setActiveTab] = useState('home'); // home, sessions, leads, agents, settings
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Context & Workspace states
    const [workspaces, setWorkspaces] = useState([]);
    const [activeWorkspace, setActiveWorkspace] = useState(null);
    const [products, setProducts] = useState([]);
    const [activeProduct, setActiveProduct] = useState(null);

    // Data states
    const [agents, setAgents] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [leads, setLeads] = useState([]);
    const [kpis, setKpis] = useState({ totalSessions: 0, avgDuration: 0, unansweredRate: 0, completionRate: 0 });

    // Search & filters
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredSessions, setFilteredSessions] = useState([]);
    const [error, setError] = useState('');

    const loadInitialContext = async () => {
        if (!token) return;
        try {
            setError('');
            // 1. Fetch workspaces
            const wsRes = await apiFetch('/api/v1/workspaces');
            if (!wsRes.ok) throw new Error('Çalışma alanları yüklenemedi.');
            const wsData = await wsRes.json();
            setWorkspaces(wsData);

            if (wsData.length > 0) {
                const initialWS = wsData[0];
                setActiveWorkspace(initialWS);
                await loadWorkspaceData(initialWS.id);
            } else {
                setLoading(false);
            }
        } catch (err) {
            console.error('Context load error:', err);
            setError(err.message);
            setLoading(false);
        }
    };

    const loadWorkspaceData = async (workspaceId) => {
        try {
            // 2. Fetch products
            const prodRes = await apiFetch(`/api/v1/products?workspaceId=${workspaceId}`);
            if (!prodRes.ok) throw new Error('Ürünler yüklenemedi.');
            const prodData = await prodRes.json();
            setProducts(prodData);

            if (prodData.length > 0) {
                const initialProduct = prodData[0];
                setActiveProduct(initialProduct);
                await loadProductAndLeadsData(workspaceId, initialProduct.id);
            } else {
                setLoading(false);
            }
        } catch (err) {
            console.error('Workspace data load error:', err);
            setError(err.message);
            setLoading(false);
        }
    };

    const loadProductAndLeadsData = async (workspaceId, productId) => {
        try {
            // 3. Fetch leads
            const leadsRes = await apiFetch(`/api/v1/analytics/leads?workspaceId=${workspaceId}`);
            if (leadsRes.ok) {
                const leadsData = await leadsRes.json();
                setLeads(leadsData.leads || []);
            }

            // 4. Fetch agents for active product
            const agentsRes = await apiFetch(`/api/v1/agents?productId=${productId}`);
            if (!agentsRes.ok) throw new Error('Temsilciler yüklenemedi.');
            const agentsData = await agentsRes.json();
            setAgents(agentsData);

            // 5. Fetch sessions and KPIs for these agents
            const allSessions = [];
            let totalSessionsSum = 0;
            let totalAvgDurationSum = 0;
            let unansweredRateSum = 0;
            let completionRateSum = 0;
            let countedKPIs = 0;

            for (const agent of agentsData) {
                // Fetch sessions
                const sessRes = await apiFetch(`/api/v1/agents/${agent._id}/sessions`);
                if (sessRes.ok) {
                    const sessData = await sessRes.json();
                    allSessions.push(...sessData.map(s => ({ ...s, agentName: agent.name })));
                }

                // Fetch KPIs
                const kpiRes = await apiFetch(`/api/v1/analytics/agents/${agent._id}`);
                if (kpiRes.ok) {
                    const kpiData = await kpiRes.json();
                    totalSessionsSum += kpiData.totalSessions || 0;
                    totalAvgDurationSum += kpiData.averageDurationSeconds || 0;
                    unansweredRateSum += kpiData.unansweredRate || 0;
                    completionRateSum += kpiData.completionRate || 0;
                    countedKPIs++;
                }
            }

            allSessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            setSessions(allSessions);
            setFilteredSessions(allSessions);

            if (countedKPIs > 0) {
                setKpis({
                    totalSessions: totalSessionsSum,
                    avgDuration: Math.round(totalAvgDurationSum / countedKPIs),
                    unansweredRate: Math.round((unansweredRateSum / countedKPIs) * 100),
                    completionRate: Math.round((completionRateSum / countedKPIs) * 100),
                });
            } else {
                setKpis({ totalSessions: 0, avgDuration: 0, unansweredRate: 0, completionRate: 0 });
            }
        } catch (err) {
            console.error('Product & Leads data load error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        if (!token) {
            router.replace('/console');
            return;
        }
        loadInitialContext();
    }, [token]);

    const handleRefresh = () => {
        setRefreshing(true);
        if (activeWorkspace && activeProduct) {
            loadProductAndLeadsData(activeWorkspace.id, activeProduct.id);
        } else {
            loadInitialContext();
        }
    };

    // Toggle agent active/paused status
    const toggleAgentStatus = async (agent) => {
        const nextStatus = agent.status === 'active' ? 'paused' : 'active';
        const endpoint = agent.status === 'active' ? 'pause' : 'activate';
        try {
            const res = await apiFetch(`/api/v1/agents/${agent._id}/${endpoint}`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error('Temsilci durumu güncellenemedi.');
            
            // Update state locally
            setAgents(prev => prev.map(a => a._id === agent._id ? { ...a, status: nextStatus } : a));
            Alert.alert('Başarılı', `“${agent.name}” artık ${nextStatus === 'active' ? 'aktif' : 'duraklatıldı'}.`);
        } catch (err) {
            Alert.alert('Hata', err.message);
        }
    };

    // Update lead status
    const updateLeadStatus = async (lead, nextStatus) => {
        try {
            const res = await apiFetch(`/api/v1/analytics/leads/${lead._id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: nextStatus }),
            });
            if (!res.ok) throw new Error('Potansiyel müşteri durumu güncellenemedi.');
            
            setLeads(prev => prev.map(l => l._id === lead._id ? { ...l, status: nextStatus } : l));
            Alert.alert('Başarılı', 'Potansiyel müşteri durumu güncellendi.');
        } catch (err) {
            Alert.alert('Hata', err.message);
        }
    };

    // Search transcripts locally
    const handleSearch = (query) => {
        setSearchQuery(query);
        if (!query.trim()) {
            setFilteredSessions(sessions);
            return;
        }
        const lower = query.toLowerCase();
        const filtered = sessions.filter(s => 
            (s.visitorName || 'visitor').toLowerCase().includes(lower) || 
            (s.agentName || '').toLowerCase().includes(lower) ||
            s.roomName.toLowerCase().includes(lower)
        );
        setFilteredSessions(filtered);
    };

    const handleLogout = () => {
        logout();
        router.replace('/console');
    };

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.lime} />
                <Text style={styles.loadingText}>Çalışma alanları yükleniyor…</Text>
            </View>
        );
    }

    const liveSessions = sessions.filter(s => s.status === 'live');
    // Client-side UX affordance only — matches the gap in the backend today
    // (agent pause/activate and lead-status routes don't enforce RBAC either),
    // so this prevents accidental taps rather than being a real security
    // boundary. Role comes straight from GET /workspaces (no extra call).
    const isViewer = activeWorkspace?.role === 'VIEWER';

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Top Workspace Selector & Header */}
            <View style={styles.header}>
                <View style={styles.headerBrandRow}>
                    <View>
                        <Text style={styles.brandTitle}>Satış merkezi</Text>
                        {activeWorkspace && <Text style={styles.workspaceSubtitle}>{activeWorkspace.name}</Text>}
                    </View>
                </View>
                <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
                    <Ionicons name="log-out-outline" size={18} color="#FF9B91" />
                </TouchableOpacity>
            </View>

            {/* Main Tabs Container */}
            <View style={styles.contentContainer}>
                {activeTab === 'home' && (
                    <ScrollView 
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.teal} />}
                        contentContainerStyle={styles.tabContent}
                    >
                        {/* KPI Cards */}
                        <Text style={styles.sectionTitle}>Performans Özeti</Text>
                        <View style={styles.kpiGrid}>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiValue}>{kpis.totalSessions}</Text>
                                <Text style={styles.kpiLabel}>Toplam Görüşme</Text>
                            </View>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiValue}>{kpis.avgDuration} sn</Text>
                                <Text style={styles.kpiLabel}>Ort. Süre</Text>
                            </View>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiValue}>{kpis.completionRate}%</Text>
                                <Text style={styles.kpiLabel}>Tamamlanma Oranı</Text>
                            </View>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiValue}>{kpis.unansweredRate}%</Text>
                                <Text style={styles.kpiLabel}>Yanıtsızlık Oranı</Text>
                            </View>
                        </View>

                        {/* Live Monitoring Section */}
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Aktif Canlı Görüşmeler ({liveSessions.length})</Text>
                            {liveSessions.length > 0 && <View style={styles.pulseDotLive} />}
                        </View>

                        {liveSessions.map((session) => (
                            <TouchableOpacity
                                key={session._id}
                                style={styles.sessionItem}
                                onPress={() => router.push(`/console/session/${session._id}`)}
                                activeOpacity={0.85}
                            >
                                <View style={styles.sessionMetaRow}>
                                    <Text style={styles.sessionVisitor}>{session.visitorName || 'Ziyaretçi'}</Text>
                                    <View style={styles.liveTag}>
                                        <Text style={styles.liveTagText}>CANLI</Text>
                                    </View>
                                </View>
                                <Text style={styles.sessionAgent}>Görüşülen temsilci: {session.agentName}</Text>
                                <Text style={styles.sessionTime}>Oda: {session.roomName}</Text>
                            </TouchableOpacity>
                        ))}
                        {liveSessions.length === 0 && (
                            <View style={styles.emptyCard}>
                                <Text style={styles.emptyCardText}>Şu anda aktif canlı görüşme yok.</Text>
                            </View>
                        )}
                    </ScrollView>
                )}

                {activeTab === 'sessions' && (
                    <View style={{ flex: 1 }}>
                        <TextInput
                            style={styles.searchBar}
                            placeholder="Görüşme veya temsilci ara…"
                            placeholderTextColor={colors.soft}
                            value={searchQuery}
                            onChangeText={handleSearch}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <FlatList
                            data={filteredSessions}
                            keyExtractor={(item) => item._id}
                            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.teal} />}
                            contentContainerStyle={styles.listContent}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.sessionItem}
                                    onPress={() => router.push(`/console/session/${item._id}`)}
                                    activeOpacity={0.85}
                                >
                                    <View style={styles.sessionMetaRow}>
                                        <Text style={styles.sessionVisitor}>{item.visitorName || 'Ziyaretçi'}</Text>
                                        <View style={[styles.badge, item.status === 'live' ? styles.badgeLive : styles.badgeEnded]}>
                                            <Text style={[styles.badgeText, item.status === 'live' ? styles.badgeLiveText : styles.badgeEndedText]}>
                                                {SESSION_STATUS_LABELS[item.status] || item.status?.toUpperCase()}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={styles.sessionAgent}>Temsilci: {item.agentName}</Text>
                                    <Text style={styles.sessionTime}>
                                        Tarih: {new Date(item.createdAt).toLocaleString('tr-TR')}
                                    </Text>
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={() => (
                                <View style={styles.emptyCard}>
                                    <Text style={styles.emptyCardText}>Geçmiş görüşme bulunamadı.</Text>
                                </View>
                            )}
                        />
                    </View>
                )}

                {activeTab === 'leads' && (
                    <FlatList
                        data={leads}
                        keyExtractor={(item) => item._id}
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.teal} />}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => (
                            <View style={styles.leadCard}>
                                <View style={styles.leadHeader}>
                                    <Text style={styles.leadEmail}>{item.contact?.email || 'İsimsiz Potansiyel Müşteri'}</Text>
                                    <View style={styles.scoreBadge}>
                                        <Text style={styles.scoreText}>Puan: {item.score}</Text>
                                    </View>
                                </View>
                                {item.contact?.company ? (
                                    <Text style={styles.leadCompany}>Şirket: {item.contact.company}</Text>
                                ) : null}

                                {/* Lead Status Actions — read-only for VIEWER role */}
                                <View style={styles.leadActionsRow}>
                                    <TouchableOpacity
                                        style={[styles.leadStatusBtn, item.status === 'new' && styles.leadStatusBtnActive, isViewer && styles.leadStatusBtnDisabled]}
                                        onPress={() => updateLeadStatus(item, 'new')}
                                        disabled={isViewer}
                                    >
                                        <Text style={[styles.leadStatusBtnText, item.status === 'new' && styles.leadStatusBtnActiveText]}>Yeni</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.leadStatusBtn, item.status === 'contacted' && styles.leadStatusBtnActive, isViewer && styles.leadStatusBtnDisabled]}
                                        onPress={() => updateLeadStatus(item, 'contacted')}
                                        disabled={isViewer}
                                    >
                                        <Text style={[styles.leadStatusBtnText, item.status === 'contacted' && styles.leadStatusBtnActiveText]}>İletişime Geçildi</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.leadStatusBtn, item.status === 'converted' && styles.leadStatusBtnActive, isViewer && styles.leadStatusBtnDisabled]}
                                        onPress={() => updateLeadStatus(item, 'converted')}
                                        disabled={isViewer}
                                    >
                                        <Text style={[styles.leadStatusBtnText, item.status === 'converted' && styles.leadStatusBtnActiveText]}>Kazanıldı</Text>
                                    </TouchableOpacity>
                                </View>

                                {/* Contact intent triggers */}
                                <View style={styles.contactActionsRow}>
                                    {item.contact?.email && (
                                        <TouchableOpacity 
                                            style={styles.contactBtn}
                                            onPress={() => Linking.openURL(`mailto:${item.contact.email}`)}
                                        >
                                            <Text style={styles.contactBtnText}>E-posta Gönder</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                        )}
                        ListEmptyComponent={() => (
                            <View style={styles.emptyCard}>
                                <Text style={styles.emptyCardText}>Henüz potansiyel müşteri yok.</Text>
                            </View>
                        )}
                    />
                )}

                {activeTab === 'agents' && (
                    <FlatList
                        data={agents}
                        keyExtractor={(item) => item._id}
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.teal} />}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => (
                            <View style={styles.agentItem}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.agentNameText}>{item.name}</Text>
                                    <Text style={styles.agentConfigText}>Avatar: {item.avatarProvider}</Text>
                                    <Text style={styles.agentConfigText}>Üslup: {formatTone(item.persona?.tone)}</Text>
                                </View>
                                <View style={styles.toggleRow}>
                                    <Text style={[styles.agentStatusIndicator, item.status === 'active' ? styles.indicatorActive : styles.indicatorPaused]}>
                                        {AGENT_STATUS_LABELS[item.status] || item.status?.toUpperCase()}
                                    </Text>
                                    <Switch
                                        value={item.status === 'active'}
                                        onValueChange={() => toggleAgentStatus(item)}
                                        disabled={isViewer}
                                        trackColor={{ false: colors.line, true: colors.tealDark }}
                                        thumbColor="#ffffff"
                                    />
                                </View>
                            </View>
                        )}
                        ListEmptyComponent={() => (
                            <View style={styles.emptyCard}>
                                <Text style={styles.emptyCardText}>Bu ürün için tanımlı temsilci yok.</Text>
                            </View>
                        )}
                    />
                )}

                {activeTab === 'settings' && (
                    <ScrollView contentContainerStyle={styles.tabContent}>
                        <Text style={styles.sectionTitle}>Görünüm</Text>
                        <View style={styles.settingsCard}>
                            <View style={styles.themeSettingRow}>
                                <View style={styles.themeSettingIcon}>
                                    <Ionicons name={isDark ? 'moon' : 'sunny'} size={18} color={colors.teal} />
                                </View>
                                <View style={styles.themeSettingCopy}>
                                    <Text style={styles.settingsValueCompact}>Koyu tema</Text>
                                    <Text style={styles.settingsLabelCompact}>Uygulama görünümünü cihazınızda saklar.</Text>
                                </View>
                                <Switch
                                    value={isDark}
                                    onValueChange={toggleTheme}
                                    trackColor={{ false: colors.line, true: colors.tealDark }}
                                    thumbColor={colors.white}
                                />
                            </View>
                        </View>

                        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Kullanıcı Hesabı</Text>
                        <View style={styles.settingsCard}>
                            <Text style={styles.settingsLabel}>Ad Soyad</Text>
                            <Text style={styles.settingsValue}>{user?.name || 'Satıcı Kullanıcı'}</Text>
                            <Text style={styles.settingsLabel}>E-posta Adresi</Text>
                            <Text style={styles.settingsValue}>{user?.email || 'seller@salesai.com'}</Text>
                        </View>

                        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Çalışma Alanları</Text>
                        <View style={styles.settingsCard}>
                            {workspaces.map((ws) => (
                                <TouchableOpacity
                                    key={ws.id}
                                    style={[styles.workspaceItem, activeWorkspace?.id === ws.id && styles.workspaceItemActive]}
                                    onPress={() => {
                                        setActiveWorkspace(ws);
                                        loadWorkspaceData(ws.id);
                                    }}
                                >
                                    <Text style={[styles.workspaceText, activeWorkspace?.id === ws.id && styles.workspaceTextActive]}>
                                        {ws.name} {ws.role ? `(${WORKSPACE_ROLE_LABELS[ws.role] || ws.role})` : ''}
                                    </Text>
                                    {activeWorkspace?.id === ws.id && <Text style={styles.activeIndicatorText}>Aktif</Text>}
                                </TouchableOpacity>
                            ))}
                        </View>
                    </ScrollView>
                )}
            </View>

            {/* Bottom Tabs Navigation Bar */}
            <View style={styles.tabBarContainer}>
                <View style={styles.floatingTabBar}>
                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('home')}>
                        <View style={[styles.iconWrapper, activeTab === 'home' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'home' ? 'home' : 'home-outline'} size={21} color={activeTab === 'home' ? colors.ink : 'rgba(255,255,255,0.4)'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'home' && styles.tabItemTextActive]}>Ana Sayfa</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('sessions')}>
                        <View style={[styles.iconWrapper, activeTab === 'sessions' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'sessions' ? 'call' : 'call-outline'} size={21} color={activeTab === 'sessions' ? colors.ink : 'rgba(255,255,255,0.4)'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'sessions' && styles.tabItemTextActive]}>Görüşmeler</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('leads')}>
                        <View style={[styles.iconWrapper, activeTab === 'leads' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'leads' ? 'people' : 'people-outline'} size={21} color={activeTab === 'leads' ? colors.ink : 'rgba(255,255,255,0.4)'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'leads' && styles.tabItemTextActive]}>Adaylar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('agents')}>
                        <View style={[styles.iconWrapper, activeTab === 'agents' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'agents' ? 'hardware-chip' : 'hardware-chip-outline'} size={21} color={activeTab === 'agents' ? colors.ink : 'rgba(255,255,255,0.4)'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'agents' && styles.tabItemTextActive]}>Temsilciler</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('settings')}>
                        <View style={[styles.iconWrapper, activeTab === 'settings' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'settings' ? 'settings' : 'settings-outline'} size={21} color={activeTab === 'settings' ? colors.ink : 'rgba(255,255,255,0.4)'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'settings' && styles.tabItemTextActive]}>Ayarlar</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
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
        color: 'rgba(255,255,255,0.55)',
        fontFamily: FONT.medium,
        fontSize: 15,
        marginTop: 16,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 58 : 34,
        paddingBottom: 16,
        backgroundColor: colors.ink,
    },
    headerBrandRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    brandTitle: {
        color: colors.white,
        fontFamily: FONT.bold,
        fontSize: 17,
    },
    workspaceSubtitle: {
        color: 'rgba(255,255,255,0.45)',
        fontFamily: FONT.medium,
        fontSize: 10.5,
        marginTop: 1,
    },
    logoutButton: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.09)',
    },
    contentContainer: {
        flex: 1,
        backgroundColor: colors.canvas,
    },
    tabContent: {
        padding: 20,
        paddingBottom: 110,
    },
    listContent: {
        padding: 20,
        paddingBottom: 110,
    },
    sectionTitle: {
        color: colors.text,
        fontFamily: FONT.bold,
        fontSize: 17,
        marginBottom: 16,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 32,
        marginBottom: 16,
    },
    pulseDotLive: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.lime,
        marginLeft: 8,
    },
    kpiGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    kpiCard: {
        flex: 1,
        minWidth: '45%',
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 17,
        borderWidth: 1,
        borderColor: colors.line,
    },
    kpiValue: {
        color: isDark ? colors.lime : colors.tealDark,
        fontFamily: FONT.bold,
        fontSize: 24,
    },
    kpiLabel: {
        color: colors.muted,
        fontFamily: FONT.medium,
        fontSize: 12,
        marginTop: 4,
    },
    sessionItem: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.line,
        marginBottom: 12,
    },
    sessionMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    sessionVisitor: {
        color: colors.text,
        fontFamily: FONT.bold,
        fontSize: 16,
        fontWeight: '700',
    },
    sessionAgent: {
        color: colors.muted,
        fontFamily: FONT.regular,
        fontSize: 14,
        marginBottom: 8,
    },
    sessionTime: {
        color: colors.soft,
        fontFamily: FONT.medium,
        fontSize: 12,
    },
    liveTag: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderRadius: 10,
    },
    liveTagText: {
        color: colors.teal,
        fontSize: 10,
        fontWeight: '800',
    },
    badge: {
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderRadius: 10,
    },
    badgeLive: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
    },
    badgeEnded: {
        backgroundColor: 'rgba(108, 114, 127, 0.15)',
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '800',
    },
    badgeLiveText: {
        color: colors.teal,
    },
    badgeEndedText: {
        color: colors.muted,
    },
    emptyCard: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 32,
        borderWidth: 1,
        borderColor: colors.line,
        alignItems: 'center',
    },
    emptyCardText: {
        color: colors.muted,
        fontFamily: FONT.medium,
        fontSize: 14,
    },
    searchBar: {
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.line,
        color: colors.text,
        fontFamily: FONT.medium,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginHorizontal: 24,
        marginTop: 24,
        marginBottom: 8,
    },
    agentItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.line,
        marginBottom: 12,
    },
    agentNameText: {
        color: colors.text,
        fontFamily: FONT.bold,
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 4,
    },
    agentConfigText: {
        color: colors.muted,
        fontFamily: FONT.regular,
        fontSize: 13,
        marginTop: 2,
    },
    toggleRow: {
        alignItems: 'center',
        gap: 6,
    },
    agentStatusIndicator: {
        fontSize: 10,
        fontWeight: '800',
    },
    indicatorActive: {
        color: colors.teal,
    },
    indicatorPaused: {
        color: '#f87171',
    },
    leadCard: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.line,
        marginBottom: 12,
    },
    leadHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    leadEmail: {
        color: colors.text,
        fontFamily: FONT.bold,
        fontSize: 16,
        fontWeight: '700',
    },
    scoreBadge: {
        backgroundColor: 'rgba(215,249,91,0.1)',
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderRadius: 10,
    },
    scoreText: {
        color: isDark ? colors.lime : colors.tealDark,
        fontFamily: FONT.bold,
        fontSize: 11,
        fontWeight: '700',
    },
    leadCompany: {
        color: colors.muted,
        fontSize: 14,
        marginBottom: 12,
    },
    leadActionsRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 8,
    },
    leadStatusBtn: {
        flex: 1,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.line,
        alignItems: 'center',
    },
    leadStatusBtnActive: {
        backgroundColor: colors.lime,
        borderColor: colors.lime,
    },
    leadStatusBtnText: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: '600',
    },
    leadStatusBtnActiveText: {
        color: colors.ink,
    },
    leadStatusBtnDisabled: {
        opacity: 0.4,
    },
    contactActionsRow: {
        borderTopWidth: 1,
        borderColor: colors.line,
        marginTop: 14,
        paddingTop: 12,
    },
    contactBtn: {
        alignSelf: 'flex-start',
    },
    contactBtnText: {
        color: colors.teal,
        fontSize: 13,
        fontWeight: '600',
    },
    settingsCard: {
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.line,
    },
    settingsLabel: {
        color: colors.soft,
        fontSize: 12,
        marginBottom: 4,
    },
    settingsValue: {
        color: colors.text,
        fontFamily: FONT.bold,
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 16,
    },
    workspaceItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderColor: colors.line,
    },
    workspaceItemActive: {
        borderColor: 'transparent',
    },
    workspaceText: {
        color: colors.muted,
        fontSize: 15,
    },
    workspaceTextActive: {
        color: isDark ? colors.lime : colors.tealDark,
        fontWeight: '700',
    },
    activeIndicatorText: {
        color: colors.teal,
        fontSize: 12,
        fontWeight: '700',
    },
    themeSettingRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    themeSettingIcon: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 13,
        backgroundColor: colors.surfaceMuted,
    },
    themeSettingCopy: {
        flex: 1,
        marginLeft: 12,
        marginRight: 12,
    },
    settingsValueCompact: {
        color: colors.text,
        fontFamily: FONT.bold,
        fontSize: 14,
    },
    settingsLabelCompact: {
        marginTop: 3,
        color: colors.muted,
        fontFamily: FONT.regular,
        fontSize: 11.5,
    },
    tabBarContainer: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 24 : 16,
        left: 14,
        right: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    floatingTabBar: {
        flexDirection: 'row',
        height: 72,
        backgroundColor: colors.inkSoft,
        borderRadius: 24,
        paddingHorizontal: 7,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        shadowColor: colors.ink,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
        width: '100%',
        maxWidth: 450,
    },
    tabItem: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconWrapper: {
        width: 44,
        height: 32,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
    },
    iconWrapperActive: {
        backgroundColor: colors.lime,
    },
    tabItemText: {
        color: 'rgba(255,255,255,0.38)',
        fontFamily: FONT.medium,
        fontSize: 10,
        fontWeight: '600',
    },
    tabItemTextActive: {
        color: colors.lime,
        fontFamily: FONT.bold,
    },
});
