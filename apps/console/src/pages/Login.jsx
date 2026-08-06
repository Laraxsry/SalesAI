import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, Logo } from '@repo/ui';
import { Mail, Lock, AlertCircle } from 'lucide-react';
import { authApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { AuthLayout } from '../lib/AuthLayout.jsx';

export function Login() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const setSession = useAuthStore((s) => s.setSession);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const data = await authApi.login({ email, password });
            setSession(data);
            navigate(location.state?.from ?? '/', { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthLayout>
            <div className="mb-8 flex justify-center lg:hidden">
                <Logo />
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-text">{t('auth.loginTitle')}</h1>
            <p className="mt-1.5 text-sm text-text-muted">{t('auth.loginSubtitle')}</p>

            <form onSubmit={onSubmit} className="mt-8">
                <Input
                    id="email"
                    label={t('auth.email')}
                    type="email"
                    icon={Mail}
                    autoComplete="email"
                    placeholder="ad@sirket.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />

                <Input
                    id="password"
                    label={t('auth.password')}
                    type="password"
                    icon={Lock}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />

                {error && (
                    <div role="alert" className="mb-4 flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                        <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
                        {error}
                    </div>
                )}

                <Button type="submit" size="lg" disabled={loading} className="w-full">
                    {loading ? t('auth.loggingIn') : t('auth.loginButton')}
                </Button>

                <p className="mt-6 text-center text-sm text-text-muted">
                    {t('auth.noAccount')}{' '}
                    <Link to="/register" className="font-semibold text-brand-light hover:text-brand">
                        {t('auth.register')}
                    </Link>
                </p>
            </form>
        </AuthLayout>
    );
}
