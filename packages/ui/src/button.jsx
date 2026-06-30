import { cn } from './cn.js';

/**
 * Minimal shared button. Apps compose richer components on top of this.
 */
export function Button({ className, variant = 'primary', ...props }) {
    const variants = {
        primary: 'bg-brand text-white hover:bg-brand-dark',
        ghost: 'bg-transparent text-text hover:bg-surface'
    };
    return (
        <button
            className={cn(
                'inline-flex items-center justify-center rounded-[var(--radius-card)] px-4 py-2 text-sm font-medium transition-colors',
                variants[variant],
                className
            )}
            {...props}
        />
    );
}
