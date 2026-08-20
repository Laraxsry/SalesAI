import { Suspense, lazy, useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { Logo, cn } from '@repo/ui';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, BookOpen, Bot, Users, BarChart3, Settings as SettingsIcon, LogOut, Menu, X } from 'lucide-react';
import { Login } from './pages/Login.jsx';
import { Register } from './pages/Register.jsx';
import { AcceptInvite } from './pages/AcceptInvite.jsx';
import { RequireAuth } from './lib/RequireAuth.jsx';
import { useAuthStore } from './store/auth.js';

const Overview = lazy(() => import('./pages/Overview.jsx').then((m) => ({ default: m.Overview })));
const ProductDetail = lazy(() => import('./pages/ProductDetail.jsx').then((m) => ({ default: m.ProductDetail })));
const Knowledge = lazy(() => import('./pages/Knowledge.jsx').then((m) => ({ default: m.Knowledge })));
const KnowledgeGaps = lazy(() => import('./pages/KnowledgeGaps.jsx').then((m) => ({ default: m.KnowledgeGaps })));
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
    const logout = useAuthStore((s) => s.logout);
    const navigate = useNavigate();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    function onLogout() {
        logout();
        navigate('/login', { replace: true });
    }

    return (
        <div className="flex min-h-screen bg-bg">
            {mobileNavOpen && (
                <button
                    type="button"
                    aria-label="Menüyü kapat"
                    className="fixed inset-0 z-30 bg-black/60 md:hidden"
                    onClick={() => setMobileNavOpen(false)}
                />
            )}
            <aside
                aria-label="Ana menü"
                className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="mb-8 px-2">
                    <div className="flex items-center justify-between">
                        <Logo />
                        <button type="button" onClick={() => setMobileNavOpen(false)} aria-label="Menüyü kapat" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-raised md:hidden">
                            <X size={18} aria-hidden="true" />
                        </button>
                    </div>
                </div>

                <nav className="flex flex-1 flex-col gap-1" aria-label="Ana navigasyon">
                    {NAV_ITEMS.map(({ to, key, icon: Icon, end }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={end}
                            onClick={() => setMobileNavOpen(false)}
                            className={({ isActive }) =>
                                cn(
                                    'flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-2.5 text-sm font-medium transition-colors',
                                    isActive
                                        ? 'bg-brand/15 text-brand-light'
                                        : 'text-text-muted hover:bg-surface-raised hover:text-text'
                                )
                            }
                        >
                            <Icon size={17} strokeWidth={2} aria-hidden="true" />
                            {t(`nav.${key}`)}
                        </NavLink>
                    ))}
                </nav>

                <div className="mt-auto flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface-raised px-3 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-brand-light">
                        {initials(user?.name || user?.email)}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text">{user?.name || 'Kullanıcı'}</p>
                        <p className="truncate text-xs text-text-muted">{user?.email}</p>
                    </div>
                    <button
                        onClick={onLogout}
                        title={t('nav.logout')}
                        aria-label={t('nav.logout')}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-text-muted transition-colors hover:bg-bg hover:text-red-400"
                    >
                        <LogOut size={16} aria-hidden="true" />
                    </button>
                </div>
            </aside>

            <div className="min-w-0 flex-1">
                <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur md:hidden">
                    <Logo />
                    <button
                        type="button"
                        onClick={() => setMobileNavOpen(true)}
                        aria-label="Menüyü aç"
                        aria-expanded={mobileNavOpen}
                        className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-input)] border border-border text-text hover:bg-surface-raised"
                    >
                        <Menu size={19} aria-hidden="true" />
                    </button>
                </header>
                <main className="overflow-y-auto p-4 sm:p-6 md:p-8">
                    <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
                </main>
            </div>
        </div>
    );
}

export function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/invite/:token" element={<AcceptInvite />} />
            <Route
                path="/*"
                element={
                    <RequireAuth>
                        <Shell>
                            <Routes>
                                <Route path="/" element={<Overview />} />
                                <Route path="/products/:id" element={<ProductDetail />} />
                                <Route path="/knowledge" element={<Knowledge />} />
                                <Route path="/knowledge/gaps" element={<KnowledgeGaps />} />
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
