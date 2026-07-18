import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { Logo, cn } from '@repo/ui';
import { LayoutDashboard, BookOpen, Bot, Users, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { Login } from './pages/Login.jsx';
import { Register } from './pages/Register.jsx';
import { Overview } from './pages/Overview.jsx';
import { ProductDetail } from './pages/ProductDetail.jsx';
import { Knowledge } from './pages/Knowledge.jsx';
import { Agents } from './pages/Agents.jsx';
import { AgentDetail } from './pages/AgentDetail.jsx';
import { Leads } from './pages/Leads.jsx';
import { Settings } from './pages/Settings.jsx';
import { RequireAuth } from './lib/RequireAuth.jsx';
import { useAuthStore } from './store/auth.js';

// Mirrors the mobile console-lite tab bar (Home/Calls/Leads/Agents/Settings)
// so sellers see the same top-level sections on web and mobile.
const NAV_ITEMS = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/knowledge', label: 'Knowledge', icon: BookOpen },
    { to: '/agents', label: 'Agents', icon: Bot },
    { to: '/leads', label: 'Leads', icon: Users },
    { to: '/settings', label: 'Settings', icon: SettingsIcon }
];

function initials(name = '') {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join('') || '?';
}

function Shell({ children }) {
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const navigate = useNavigate();

    function onLogout() {
        logout();
        navigate('/login', { replace: true });
    }

    return (
        <div className="flex min-h-screen bg-bg">
            <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6">
                <div className="mb-8 px-2">
                    <Logo />
                </div>

                <nav className="flex flex-1 flex-col gap-1">
                    {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={end}
                            className={({ isActive }) =>
                                cn(
                                    'flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-2.5 text-sm font-medium transition-colors',
                                    isActive
                                        ? 'bg-brand/15 text-brand-light'
                                        : 'text-text-muted hover:bg-surface-raised hover:text-text'
                                )
                            }
                        >
                            <Icon size={17} strokeWidth={2} />
                            {label}
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
                        title="Çıkış yap"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-text-muted transition-colors hover:bg-bg hover:text-red-400"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto p-8">{children}</main>
        </div>
    );
}

export function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
                path="/*"
                element={
                    <RequireAuth>
                        <Shell>
                            <Routes>
                                <Route path="/" element={<Overview />} />
                                <Route path="/products/:id" element={<ProductDetail />} />
                                <Route path="/knowledge" element={<Knowledge />} />
                                <Route path="/agents" element={<Agents />} />
                                <Route path="/agents/:id" element={<AgentDetail />} />
                                <Route path="/agents/:id/sessions" element={<h1 className="text-xl font-semibold text-text">Transcripts + analytics</h1>} />
                                <Route path="/leads" element={<Leads />} />
                                <Route path="/settings" element={<Settings />} />
                            </Routes>
                        </Shell>
                    </RequireAuth>
                }
            />
        </Routes>
    );
}
