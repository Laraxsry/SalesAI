import { Suspense, lazy, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { Logo, cn } from '@repo/ui';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, BookOpen, Bot, Users, BarChart3, Settings as SettingsIcon, LogOut, Menu, X, ChevronDown, Sparkles, Moon, Sun } from 'lucide-react';
import { Login } from './pages/Login.jsx';
import { Register } from './pages/Register.jsx';
import { AcceptInvite } from './pages/AcceptInvite.jsx';
import { Landing } from './pages/Landing.jsx';
import { RequireAuth } from './lib/RequireAuth.jsx';
import { useAuthStore } from './store/auth.js';
import { useTheme } from './lib/ThemeProvider.jsx';

const Overview = lazy(() => import('./pages/Overview.jsx').then((m) => ({ default: m.Overview })));
const ProductDetail = lazy(() => import('./pages/ProductDetail.jsx').then((m) => ({ default: m.ProductDetail })));
const Knowledge = lazy(() => import('./pages/Knowledge.jsx').then((m) => ({ default: m.Knowledge })));
const KnowledgeGaps = lazy(() => import('./pages/KnowledgeGaps.jsx').then((m) => ({ default: m.KnowledgeGaps })));
const KnowledgeAudit = lazy(() => import('./pages/KnowledgeAudit.jsx').then((m) => ({ default: m.KnowledgeAudit })));
const Agents = lazy(() => import('./pages/Agents.jsx').then((m) => ({ default: m.Agents })));
const AgentDetail = lazy(() => import('./pages/AgentDetail.jsx').then((m) => ({ default: m.AgentDetail })));
const AgentSessions = lazy(() => import('./pages/AgentSessions.jsx').then((m) => ({ default: m.AgentSessions })));
const AgentGoals = lazy(() => import('./pages/AgentGoals.jsx').then((m) => ({ default: m.AgentGoals })));
const EmbedStudio = lazy(() => import('./pages/EmbedStudio.jsx').then((m) => ({ default: m.EmbedStudio })));
const Analytics = lazy(() => import('./pages/Analytics.jsx').then((m) => ({ default: m.Analytics })));
const Leads = lazy(() => import('./pages/Leads.jsx').then((m) => ({ default: m.Leads })));
const Settings = lazy(() => import('./pages/Settings.jsx').then((m) => ({ default: m.Settings })));
const SettingsMembers = lazy(() => import('./pages/SettingsMembers.jsx').then((m) => ({ default: m.SettingsMembers })));
const SettingsBilling = lazy(() => import('./pages/SettingsBilling.jsx').then((m) => ({ default: m.SettingsBilling })));
const SettingsApiKeys = lazy(() => import('./pages/SettingsApiKeys.jsx').then((m) => ({ default: m.SettingsApiKeys })));

// Mirrors the mobile console-lite tab bar (Home/Calls/Leads/Agents/Settings)
// so sellers see the same top-level sections on web and mobile.
const NAV_ITEMS = [
    { to: '/', key: 'overview', icon: LayoutDashboard, end: true },
    { to: '/knowledge', key: 'knowledge', icon: BookOpen },
    { to: '/agents', key: 'agents', icon: Bot },
    { to: '/analytics', key: 'analytics', icon: BarChart3 },
    { to: '/leads', key: 'leads', icon: Users },
    { to: '/settings', key: 'settings', icon: SettingsIcon }
];

function initials(name = '') {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join('') || '?';
}

function PageSkeleton() {
    return (
        <div className="flex flex-col gap-4" role="status" aria-label="Yükleniyor">
            <div className="h-7 w-48 animate-pulse rounded-[var(--radius-input)] bg-surface-raised" />
            <div className="h-4 w-72 animate-pulse rounded-[var(--radius-input)] bg-surface-raised" />
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="h-28 animate-pulse rounded-[var(--radius-card)] bg-surface-raised" />
                ))}
            </div>
        </div>
    );
}

function Shell({ children }) {
    const { t } = useTranslation();
    const user = useAuthStore((s) => s.user);
    const workspace = useAuthStore((s) => s.workspace);
    const logout = useAuthStore((s) => s.logout);
    const navigate = useNavigate();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const { isDark, toggleTheme } = useTheme();

    function onLogout() {
        logout();
        navigate('/login', { replace: true });
    }

    return (
        <div className="relative flex min-h-screen bg-bg">
            <div className="console-grid pointer-events-none fixed inset-0" aria-hidden="true" />
            {mobileNavOpen && (
                <button
                    type="button"
                    aria-label="Menüyü kapat"
                    className="fixed inset-0 z-30 bg-[color-mix(in_srgb,var(--color-shell)_70%,transparent)] backdrop-blur-sm md:hidden"
                    onClick={() => setMobileNavOpen(false)}
                />
            )}
            <aside
                aria-label="Ana menü"
                className={`sidebar-glow fixed inset-y-0 left-0 z-40 flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-white/8 bg-[var(--color-shell)] px-4 py-5 text-white shadow-2xl shadow-black/10 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="relative z-10 mb-7 px-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Logo className="[&_span]:text-white [&_span_span]:text-[var(--color-accent)]" />
                        </div>
                        <button type="button" onClick={() => setMobileNavOpen(false)} aria-label="Menüyü kapat" className="flex h-9 w-9 items-center justify-center rounded-xl text-white/60 hover:bg-white/8 hover:text-white md:hidden">
                            <X size={18} aria-hidden="true" />
                        </button>
                    </div>
                </div>

                <div className="relative z-10 mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Çalışma Alanı</div>
                <nav className="relative z-10 flex flex-1 flex-col gap-1" aria-label="Ana navigasyon">
                    {NAV_ITEMS.map(({ to, key, icon: Icon, end }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={end}
                            onClick={() => setMobileNavOpen(false)}
                            className={({ isActive }) =>
                                cn(
                                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all',
                                    isActive
                                        ? 'bg-white/10 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]'
                                        : 'text-white/55 hover:bg-white/6 hover:text-white'
                                )
                            }
                        >
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-white/70 transition-colors group-hover:text-[var(--color-accent)]">
                                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                            </span>
                            {t(`nav.${key}`)}
                        </NavLink>
                    ))}
                </nav>

                <div className="relative z-10 mt-auto flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.05] px-3 py-3 backdrop-blur">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent)] text-xs font-extrabold text-[var(--color-shell)]">
                        {initials(user?.name || user?.email)}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{user?.name || 'Kullanıcı'}</p>
                        <p className="truncate text-[11px] text-white/45">{user?.email}</p>
                    </div>
                    <button
                        onClick={onLogout}
                        title={t('nav.logout')}
                        aria-label={t('nav.logout')}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/8 hover:text-[#ff8a80]"
                    >
                        <LogOut size={16} aria-hidden="true" />
                    </button>
                </div>
            </aside>

            <div className="relative z-10 min-w-0 flex-1">
                <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/80 bg-surface/85 px-4 backdrop-blur-xl md:px-7">
                    <div className="flex items-center gap-3 md:hidden">
                        <Logo />
                    </div>
                    <div className="hidden items-center gap-3 md:flex">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand"><Sparkles size={17} /></span>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Aktif çalışma alanı</p>
                            <button type="button" className="mt-0.5 flex items-center gap-1 text-sm font-bold text-text">
                                {workspace?.name || 'SalesAI Workspace'} <ChevronDown size={14} className="text-text-muted" />
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={toggleTheme}
                            title={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
                            aria-label={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-text shadow-sm transition-colors hover:bg-surface-raised"
                        >
                            {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label="Menüyü aç"
                            aria-expanded={mobileNavOpen}
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-text shadow-sm hover:bg-surface-raised md:hidden"
                        >
                            <Menu size={19} aria-hidden="true" />
                        </button>
                    </div>
                </header>
                <main className="mx-auto w-full max-w-[1480px] overflow-y-auto p-4 sm:p-6 md:p-8 lg:p-10">
                    <div className="page-enter"><Suspense fallback={<PageSkeleton />}>{children}</Suspense></div>
                </main>
            </div>
        </div>
    );
}

export function App() {
    const accessToken = useAuthStore((state) => state.accessToken);

    return (
        <Routes>
            <Route
                path="/"
                element={
                    accessToken ? (
                        <RequireAuth>
                            <Shell><Overview /></Shell>
                        </RequireAuth>
                    ) : (
                        <Landing />
                    )
                }
            />
            <Route path="/mainpage" element={<Landing />} />
            <Route path="/home" element={<Navigate to="/mainpage" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/invite/:token" element={<AcceptInvite />} />
            <Route
                path="/*"
                element={
                    <RequireAuth>
                        <Shell>
                            <Routes>
                                <Route path="/products/:id" element={<ProductDetail />} />
                                <Route path="/knowledge" element={<Knowledge />} />
                                <Route path="/knowledge/gaps" element={<KnowledgeGaps />} />
                                <Route path="/knowledge/audit" element={<KnowledgeAudit />} />
                                <Route path="/agents" element={<Agents />} />
                                <Route path="/agents/:id" element={<AgentDetail />} />
                                <Route path="/agents/:id/goals" element={<AgentGoals />} />
                                <Route path="/agents/:id/sessions" element={<AgentSessions />} />
                                <Route path="/agents/:id/embed" element={<EmbedStudio />} />
                                <Route path="/analytics" element={<Analytics />} />
                                <Route path="/leads" element={<Leads />} />
                                <Route path="/settings" element={<Settings />} />
                                <Route path="/settings/members" element={<SettingsMembers />} />
                                <Route path="/settings/billing" element={<SettingsBilling />} />
                                <Route path="/settings/api-keys" element={<SettingsApiKeys />} />
                            </Routes>
                        </Shell>
                    </RequireAuth>
                }
            />
        </Routes>
    );
}
