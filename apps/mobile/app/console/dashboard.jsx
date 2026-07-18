import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, FlatList, RefreshControl, Switch, Platform, Alert, Linking, TextInput } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './_layout';
import { CONFIG } from '../../config';

export default function DashboardScreen() {
    const router = useRouter();
    const { token, user, logout } = useAuth();

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
            const wsRes = await fetch(`${CONFIG.API_URL}/api/v1/workspaces`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!wsRes.ok) throw new Error('Failed to fetch workspaces');
            const wsData = await wsRes.json();
            setWorkspaces(wsData);

            if (wsData.length > 0) {
                const initialWS = wsData[0];
                setActiveWorkspace(initialWS);
                await loadWorkspaceData(initialWS._id);
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
            const prodRes = await fetch(`${CONFIG.API_URL}/api/v1/products?workspaceId=${workspaceId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!prodRes.ok) throw new Error('Failed to fetch products');
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
            const leadsRes = await fetch(`${CONFIG.API_URL}/api/v1/analytics/leads?workspaceId=${workspaceId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (leadsRes.ok) {
                const leadsData = await leadsRes.json();
                setLeads(leadsData.leads || []);
            }

            // 4. Fetch agents for active product
            const agentsRes = await fetch(`${CONFIG.API_URL}/api/v1/agents?productId=${productId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!agentsRes.ok) throw new Error('Failed to fetch agents');
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
                const sessRes = await fetch(`${CONFIG.API_URL}/api/v1/agents/${agent._id}/sessions`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (sessRes.ok) {
                    const sessData = await sessRes.json();
                    allSessions.push(...sessData.map(s => ({ ...s, agentName: agent.name })));
                }

                // Fetch KPIs
                const kpiRes = await fetch(`${CONFIG.API_URL}/api/v1/analytics/agents/${agent._id}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
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
            loadProductAndLeadsData(activeWorkspace._id, activeProduct.id);
        } else {
            loadInitialContext();
        }
    };

    // Toggle agent active/paused status
    const toggleAgentStatus = async (agent) => {
        const nextStatus = agent.status === 'active' ? 'paused' : 'active';
        const endpoint = agent.status === 'active' ? 'pause' : 'activate';
        try {
            const res = await fetch(`${CONFIG.API_URL}/api/v1/agents/${agent._id}/${endpoint}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`Failed to update status to ${nextStatus}`);
            
            // Update state locally
            setAgents(prev => prev.map(a => a._id === agent._id ? { ...a, status: nextStatus } : a));
            Alert.alert('Success', `Agent ${agent.name} is now ${nextStatus}`);
        } catch (err) {
            Alert.alert('Error', err.message);
        }
    };

    // Update lead status
    const updateLeadStatus = async (lead, nextStatus) => {
        try {
            const res = await fetch(`${CONFIG.API_URL}/api/v1/analytics/leads/${lead._id}/status`, {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: nextStatus }),
            });
            if (!res.ok) throw new Error('Failed to update lead status');
            
            setLeads(prev => prev.map(l => l._id === lead._id ? { ...l, status: nextStatus } : l));
            Alert.alert('Success', 'Lead status updated successfully');
        } catch (err) {
            Alert.alert('Error', err.message);
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
                <ActivityIndicator size="large" color="#6d5efc" />
                <Text style={styles.loadingText}>Connecting to console workspaces...</Text>
            </View>
        );
    }

    const liveSessions = sessions.filter(s => s.status === 'live');

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Top Workspace Selector & Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.brandTitle}>SalesAI Console</Text>
                    {activeWorkspace && (
                        <Text style={styles.workspaceSubtitle}>
                            Workspace: {activeWorkspace.name}
                        </Text>
                    )}
                </View>
                <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
                    <Text style={styles.logoutText}>Logout</Text>
                </TouchableOpacity>
            </View>

            {/* Main Tabs Container */}
            <View style={styles.contentContainer}>
                {activeTab === 'home' && (
                    <ScrollView 
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6d5efc" />}
                        contentContainerStyle={styles.tabContent}
                    >
                        {/* KPI Cards */}
                        <Text style={styles.sectionTitle}>Performance Overview</Text>
                        <View style={styles.kpiGrid}>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiValue}>{kpis.totalSessions}</Text>
                                <Text style={styles.kpiLabel}>Total Sessions</Text>
                            </View>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiValue}>{kpis.avgDuration}s</Text>
                                <Text style={styles.kpiLabel}>Avg Duration</Text>
                            </View>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiValue}>{kpis.completionRate}%</Text>
                                <Text style={styles.kpiLabel}>Completion Rate</Text>
                            </View>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiValue}>{kpis.unansweredRate}%</Text>
                                <Text style={styles.kpiLabel}>Unanswered Rate</Text>
                            </View>
                        </View>

                        {/* Live Monitoring Section */}
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Active Live Sessions ({liveSessions.length})</Text>
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
                                    <Text style={styles.sessionVisitor}>{session.visitorName || 'Visitor'}</Text>
                                    <View style={styles.liveTag}>
                                        <Text style={styles.liveTagText}>LIVE</Text>
                                    </View>
                                </View>
                                <Text style={styles.sessionAgent}>Speaking with {session.agentName}</Text>
                                <Text style={styles.sessionTime}>Room: {session.roomName}</Text>
                            </TouchableOpacity>
                        ))}
                        {liveSessions.length === 0 && (
                            <View style={styles.emptyCard}>
                                <Text style={styles.emptyCardText}>No active live calls currently.</Text>
                            </View>
                        )}
                    </ScrollView>
                )}

                {activeTab === 'sessions' && (
                    <View style={{ flex: 1 }}>
                        <TextInput
                            style={styles.searchBar}
                            placeholder="Search sessions or agents..."
                            placeholderTextColor="#6c727f"
                            value={searchQuery}
                            onChangeText={handleSearch}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <FlatList
                            data={filteredSessions}
                            keyExtractor={(item) => item._id}
                            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6d5efc" />}
                            contentContainerStyle={styles.listContent}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.sessionItem}
                                    onPress={() => router.push(`/console/session/${item._id}`)}
                                    activeOpacity={0.85}
                                >
                                    <View style={styles.sessionMetaRow}>
                                        <Text style={styles.sessionVisitor}>{item.visitorName || 'Visitor'}</Text>
                                        <View style={[styles.badge, item.status === 'live' ? styles.badgeLive : styles.badgeEnded]}>
                                            <Text style={[styles.badgeText, item.status === 'live' ? styles.badgeLiveText : styles.badgeEndedText]}>
                                                {item.status.toUpperCase()}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={styles.sessionAgent}>Agent: {item.agentName}</Text>
                                    <Text style={styles.sessionTime}>
                                        Date: {new Date(item.createdAt).toLocaleString('tr-TR')}
                                    </Text>
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={() => (
                                <View style={styles.emptyCard}>
                                    <Text style={styles.emptyCardText}>No past conversations found.</Text>
                                </View>
                            )}
                        />
                    </View>
                )}

                {activeTab === 'leads' && (
                    <FlatList
                        data={leads}
                        keyExtractor={(item) => item._id}
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6d5efc" />}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => (
                            <View style={styles.leadCard}>
                                <View style={styles.leadHeader}>
                                    <Text style={styles.leadEmail}>{item.contact?.email || 'Anonymous Lead'}</Text>
                                    <View style={styles.scoreBadge}>
                                        <Text style={styles.scoreText}>Score: {item.score}</Text>
                                    </View>
                                </View>
                                {item.contact?.company ? (
                                    <Text style={styles.leadCompany}>Company: {item.contact.company}</Text>
                                ) : null}

                                {/* Lead Status Actions */}
                                <View style={styles.leadActionsRow}>
                                    <TouchableOpacity 
                                        style={[styles.leadStatusBtn, item.status === 'new' && styles.leadStatusBtnActive]}
                                        onPress={() => updateLeadStatus(item, 'new')}
                                    >
                                        <Text style={[styles.leadStatusBtnText, item.status === 'new' && styles.leadStatusBtnActiveText]}>New</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={[styles.leadStatusBtn, item.status === 'contacted' && styles.leadStatusBtnActive]}
                                        onPress={() => updateLeadStatus(item, 'contacted')}
                                    >
                                        <Text style={[styles.leadStatusBtnText, item.status === 'contacted' && styles.leadStatusBtnActiveText]}>Contacted</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={[styles.leadStatusBtn, item.status === 'converted' && styles.leadStatusBtnActive]}
                                        onPress={() => updateLeadStatus(item, 'converted')}
                                    >
                                        <Text style={[styles.leadStatusBtnText, item.status === 'converted' && styles.leadStatusBtnActiveText]}>Won</Text>
                                    </TouchableOpacity>
                                </View>

                                {/* Contact intent triggers */}
                                <View style={styles.contactActionsRow}>
                                    {item.contact?.email && (
                                        <TouchableOpacity 
                                            style={styles.contactBtn}
                                            onPress={() => Linking.openURL(`mailto:${item.contact.email}`)}
                                        >
                                            <Text style={styles.contactBtnText}>📧 Email Lead</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                        )}
                        ListEmptyComponent={() => (
                            <View style={styles.emptyCard}>
                                <Text style={styles.emptyCardText}>No leads captured yet.</Text>
                            </View>
                        )}
                    />
                )}

                {activeTab === 'agents' && (
                    <FlatList
                        data={agents}
                        keyExtractor={(item) => item._id}
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6d5efc" />}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => (
                            <View style={styles.agentItem}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.agentNameText}>{item.name}</Text>
                                    <Text style={styles.agentConfigText}>Avatar: {item.avatarProvider}</Text>
                                    <Text style={styles.agentConfigText}>Tone: {item.persona?.tone || 'Friendly'}</Text>
                                </View>
                                <View style={styles.toggleRow}>
                                    <Text style={[styles.agentStatusIndicator, item.status === 'active' ? styles.indicatorActive : styles.indicatorPaused]}>
                                        {item.status.toUpperCase()}
                                    </Text>
                                    <Switch
                                        value={item.status === 'active'}
                                        onValueChange={() => toggleAgentStatus(item)}
                                        trackColor={{ false: '#2d2d44', true: '#10b981' }}
                                        thumbColor="#ffffff"
                                    />
                                </View>
                            </View>
                        )}
                        ListEmptyComponent={() => (
                            <View style={styles.emptyCard}>
                                <Text style={styles.emptyCardText}>No agents defined in this product.</Text>
                            </View>
                        )}
                    />
                )}

                {activeTab === 'settings' && (
                    <ScrollView contentContainerStyle={styles.tabContent}>
                        <Text style={styles.sectionTitle}>User Account</Text>
                        <View style={styles.settingsCard}>
                            <Text style={styles.settingsLabel}>Name</Text>
                            <Text style={styles.settingsValue}>{user?.name || 'Seller User'}</Text>
                            <Text style={styles.settingsLabel}>Email Address</Text>
                            <Text style={styles.settingsValue}>{user?.email || 'seller@salesai.com'}</Text>
                        </View>

                        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Workspaces</Text>
                        <View style={styles.settingsCard}>
                            {workspaces.map((ws) => (
                                <TouchableOpacity 
                                    key={ws._id} 
                                    style={[styles.workspaceItem, activeWorkspace?._id === ws._id && styles.workspaceItemActive]}
                                    onPress={() => {
                                        setActiveWorkspace(ws);
                                        loadWorkspaceData(ws._id);
                                    }}
                                >
                                    <Text style={[styles.workspaceText, activeWorkspace?._id === ws._id && styles.workspaceTextActive]}>
                                        {ws.name}
                                    </Text>
                                    {activeWorkspace?._id === ws._id && <Text style={styles.activeIndicatorText}>Active</Text>}
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
                            <Ionicons name={activeTab === 'home' ? 'home' : 'home-outline'} size={22} color={activeTab === 'home' ? '#ffffff' : '#6c727f'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'home' && styles.tabItemTextActive]}>Home</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('sessions')}>
                        <View style={[styles.iconWrapper, activeTab === 'sessions' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'sessions' ? 'call' : 'call-outline'} size={22} color={activeTab === 'sessions' ? '#ffffff' : '#6c727f'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'sessions' && styles.tabItemTextActive]}>Calls</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('leads')}>
                        <View style={[styles.iconWrapper, activeTab === 'leads' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'leads' ? 'people' : 'people-outline'} size={22} color={activeTab === 'leads' ? '#ffffff' : '#6c727f'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'leads' && styles.tabItemTextActive]}>Leads</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('agents')}>
                        <View style={[styles.iconWrapper, activeTab === 'agents' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'agents' ? 'hardware-chip' : 'hardware-chip-outline'} size={22} color={activeTab === 'agents' ? '#ffffff' : '#6c727f'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'agents' && styles.tabItemTextActive]}>Agents</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('settings')}>
                        <View style={[styles.iconWrapper, activeTab === 'settings' && styles.iconWrapperActive]}>
                            <Ionicons name={activeTab === 'settings' ? 'settings' : 'settings-outline'} size={22} color={activeTab === 'settings' ? '#ffffff' : '#6c727f'} />
                        </View>
                        <Text style={[styles.tabItemText, activeTab === 'settings' && styles.tabItemTextActive]}>Settings</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
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
        fontSize: 15,
        marginTop: 16,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        paddingBottom: 20,
        backgroundColor: '#10101a',
        borderBottomWidth: 1,
        borderColor: '#1e1e2f',
    },
    brandTitle: {
        color: '#ffffff',
        fontSize: 20,
        fontWeight: '800',
    },
    workspaceSubtitle: {
        color: '#6d5efc',
        fontSize: 12,
        fontWeight: '600',
        marginTop: 2,
    },
    logoutButton: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: '#1b1b2a',
        borderWidth: 1,
        borderColor: '#2d2d44',
    },
    logoutText: {
        color: '#f87171',
        fontSize: 12,
        fontWeight: '600',
    },
    contentContainer: {
        flex: 1,
    },
    tabContent: {
        padding: 24,
        paddingBottom: 110,
    },
    listContent: {
        padding: 24,
        paddingBottom: 110,
    },
    sectionTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '700',
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
        backgroundColor: '#10b981',
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
        backgroundColor: '#13131e',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#242436',
    },
    kpiValue: {
        color: '#6d5efc',
        fontSize: 24,
        fontWeight: '800',
    },
    kpiLabel: {
        color: '#9ba1b0',
        fontSize: 12,
        marginTop: 4,
    },
    sessionItem: {
        backgroundColor: '#13131e',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#242436',
        marginBottom: 12,
    },
    sessionMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    sessionVisitor: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700',
    },
    sessionAgent: {
        color: '#9ba1b0',
        fontSize: 14,
        marginBottom: 8,
    },
    sessionTime: {
        color: '#6c727f',
        fontSize: 12,
    },
    liveTag: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderRadius: 10,
    },
    liveTagText: {
        color: '#10b981',
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
        color: '#10b981',
    },
    badgeEndedText: {
        color: '#9ba1b0',
    },
    emptyCard: {
        backgroundColor: '#13131e',
        borderRadius: 16,
        padding: 32,
        borderWidth: 1,
        borderColor: '#242436',
        alignItems: 'center',
    },
    emptyCardText: {
        color: '#4e5564',
        fontSize: 14,
    },
    searchBar: {
        backgroundColor: '#13131e',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#242436',
        color: '#ffffff',
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginHorizontal: 24,
        marginTop: 24,
        marginBottom: 8,
    },
    agentItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#13131e',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#242436',
        marginBottom: 12,
    },
    agentNameText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 4,
    },
    agentConfigText: {
        color: '#9ba1b0',
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
        color: '#10b981',
    },
    indicatorPaused: {
        color: '#f87171',
    },
    leadCard: {
        backgroundColor: '#13131e',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#242436',
        marginBottom: 12,
    },
    leadHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    leadEmail: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700',
    },
    scoreBadge: {
        backgroundColor: 'rgba(109, 94, 252, 0.15)',
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderRadius: 10,
    },
    scoreText: {
        color: '#6d5efc',
        fontSize: 11,
        fontWeight: '700',
    },
    leadCompany: {
        color: '#9ba1b0',
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
        backgroundColor: '#1b1b2a',
        borderWidth: 1,
        borderColor: '#2d2d44',
        alignItems: 'center',
    },
    leadStatusBtnActive: {
        backgroundColor: '#6d5efc',
        borderColor: '#6d5efc',
    },
    leadStatusBtnText: {
        color: '#9ba1b0',
        fontSize: 12,
        fontWeight: '600',
    },
    leadStatusBtnActiveText: {
        color: '#ffffff',
    },
    contactActionsRow: {
        borderTopWidth: 1,
        borderColor: '#1e1e2f',
        marginTop: 14,
        paddingTop: 12,
    },
    contactBtn: {
        alignSelf: 'flex-start',
    },
    contactBtnText: {
        color: '#6d5efc',
        fontSize: 13,
        fontWeight: '600',
    },
    settingsCard: {
        backgroundColor: '#13131e',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#242436',
    },
    settingsLabel: {
        color: '#6c727f',
        fontSize: 12,
        marginBottom: 4,
    },
    settingsValue: {
        color: '#ffffff',
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
        borderColor: '#1e1e2f',
    },
    workspaceItemActive: {
        borderColor: 'transparent',
    },
    workspaceText: {
        color: '#9ba1b0',
        fontSize: 15,
    },
    workspaceTextActive: {
        color: '#6d5efc',
        fontWeight: '700',
    },
    activeIndicatorText: {
        color: '#10b981',
        fontSize: 12,
        fontWeight: '700',
    },
    tabBarContainer: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 30 : 20,
        left: 20,
        right: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    floatingTabBar: {
        flexDirection: 'row',
        height: 70,
        backgroundColor: 'rgba(22, 22, 34, 0.95)',
        borderRadius: 35,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        shadowColor: '#000',
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
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
    },
    iconWrapperActive: {
        backgroundColor: 'rgba(109, 94, 252, 0.2)',
    },
    tabItemText: {
        color: '#6c727f',
        fontSize: 10,
        fontWeight: '600',
    },
    tabItemTextActive: {
        color: '#ffffff',
        fontWeight: '700',
    },
});
