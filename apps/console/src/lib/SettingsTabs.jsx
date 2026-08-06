import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@repo/ui';

const TABS = [
    { to: '/settings', key: 'account', end: true },
    { to: '/settings/members', key: 'members' },
    { to: '/settings/billing', key: 'billing' },
    { to: '/settings/api-keys', key: 'apiKeys' }
];

export function SettingsTabs() {
    const { t } = useTranslation();
    return (
        <div className="mb-8 flex gap-1 border-b border-border" role="tablist" aria-label={t('settings.title')}>
            {TABS.map(({ to, key, end }) => (
                <NavLink
                    key={to}
                    to={to}
                    end={end}
                    role="tab"
                    className={({ isActive }) =>
                        cn(
                            'border-b-2 px-3 pb-3 text-sm font-medium transition-colors',
                            isActive
                                ? 'border-brand text-text'
                                : 'border-transparent text-text-muted hover:text-text'
                        )
                    }
                >
                    {t(`settings.tabs.${key}`)}
                </NavLink>
            ))}
        </div>
    );
}
