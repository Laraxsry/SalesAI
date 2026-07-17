import { cn } from './cn.js';

/**
 * Minimal shared button. Apps compose richer components on top of this.
 */
export function Button({ className, variant = 'primary', size = 'md', ...props }) {
    const variants = {
        primary:
            'bg-brand text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_20px_-8px_rgba(109,94,252,0.65)] hover:bg-brand-dark active:scale-[0.98]',
        secondary: 'bg-surface-raised text-text border border-border hover:border-brand/50 active:scale-[0.98]',
        ghost: 'bg-transparent text-text-muted hover:bg-surface-raised hover:text-text'
    };
    const sizes = {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-sm'
    };
    return (
        <button
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded-[var(--radius-input)] font-semibold transition-all',
                'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
                variants[variant],
                sizes[size],
                className
            )}
            {...props}
        />
    );
}
