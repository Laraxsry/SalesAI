import { cn } from './cn.js';

/** Shared text input with label + error slot. */
export function Input({ className, label, error, icon: Icon, id, ...props }) {
    return (
        <label className="mb-4 block text-sm last:mb-0" htmlFor={id}>
            {label && <span className="mb-1.5 block font-medium text-text-muted">{label}</span>}
            <span className="relative flex items-center">
                {Icon && <Icon size={16} className="pointer-events-none absolute left-3 text-text-muted" />}
                <input
                    id={id}
                    className={cn(
                        'h-10 w-full rounded-[var(--radius-input)] border border-border bg-bg pl-3 pr-3 text-[13.5px] text-text',
                        'outline-none transition-colors placeholder:text-text-muted/60',
                        'focus:border-brand focus:ring-2 focus:ring-brand/20',
                        Icon && 'pl-9',
                        error && 'border-red-500/60 focus:border-red-500 focus:ring-red-500/20',
                        className
                    )}
                    {...props}
                />
            </span>
            {error && <span className="mt-1.5 block text-xs text-red-400">{error}</span>}
        </label>
    );
}
