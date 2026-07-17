import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input, Logo } from '@repo/ui';
import { Mail, Lock, User, AlertCircle } from 'lucide-react';
import { authApi } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';
import { AuthLayout } from '../lib/AuthLayout.jsx';

export function Register() {
    const navigate = useNavigate();
    const setSession = useAuthStore((s) => s.setSession);

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const data = await authApi.register({ name, email, password });
            setSession(data);
            navigate('/', { replace: true });
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

            <h1 className="text-2xl font-bold tracking-tight text-text">Hesap oluştur</h1>
            <p className="mt-1.5 text-sm text-text-muted">30 saniyede workspace'ini kur, ücretsiz başla.</p>

            <form onSubmit={onSubmit} className="mt-8">
                <Input
                    id="name"
                    label="İsim"
                    type="text"
                    icon={User}
                    autoComplete="name"
                    placeholder="Ad Soyad"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />

                <Input
                    id="email"
                    label="Email"
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
                    label="Şifre"
                    type="password"
                    icon={Lock}
                    autoComplete="new-password"
                    placeholder="En az 8 karakter"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />

                {error && (
                    <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-input)] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                        <AlertCircle size={16} className="shrink-0" />
                        {error}
                    </div>
                )}

                <Button type="submit" size="lg" disabled={loading} className="w-full">
                    {loading ? 'Oluşturuluyor…' : 'Ücretsiz kayıt ol'}
                </Button>

                <p className="mt-6 text-center text-sm text-text-muted">
                    Zaten hesabın var mı?{' '}
                    <Link to="/login" className="font-semibold text-brand-light hover:text-brand">
                        Giriş yap
                    </Link>
                </p>
            </form>
        </AuthLayout>
    );
}
