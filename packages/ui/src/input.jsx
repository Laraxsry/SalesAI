import { useState } from 'react';
import { cn } from './cn.js';

function EyeIcon({ off }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
            <circle cx="12" cy="12" r="3" />
            {off && <path d="M3 3l18 18" />}
        </svg>
    );
}

/** Shared text input with label + error slot. Password inputs get a show/hide toggle. */
export function Input({
    className,
    label,
    error,
    icon: Icon,
    id,
    type,
    showPasswordLabel = 'Şifreyi göster',
    hidePasswordLabel = 'Şifreyi gizle',
    ...props
}) {
    const [revealed, setRevealed] = useState(false);
    const isPassword = type === 'password';

    return (
        <label className="mb-4 block text-sm last:mb-0" htmlFor={id}>
            {label && <span className="mb-1.5 block font-medium text-text-muted">{label}</span>}
            <span className="relative flex items-center">
                {Icon && <Icon size={16} className="pointer-events-none absolute left-3 text-text-muted" />}
                <input
                    id={id}
                    type={isPassword && revealed ? 'text' : type}
                    className={cn(
                        'h-10 w-full rounded-[var(--radius-input)] border border-border bg-bg pl-3 pr-3 text-[13.5px] text-text',
                        'outline-none transition-colors placeholder:text-text-muted/60',
                        'focus:border-brand focus:ring-2 focus:ring-brand/20',
                        Icon && 'pl-9',
                        isPassword && 'pr-10',
                        error && 'border-red-500/60 focus:border-red-500 focus:ring-red-500/20',
                        className
                    )}
                    {...props}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setRevealed((value) => !value)}
                        aria-label={revealed ? hidePasswordLabel : showPasswordLabel}
                        title={revealed ? hidePasswordLabel : showPasswordLabel}
                        aria-pressed={revealed}
                        className="absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                    >
                        <EyeIcon off={revealed} />
                    </button>
                )}
            </span>
            {error && <span className="mt-1.5 block text-xs text-red-400">{error}</span>}
        </label>
    );
}
