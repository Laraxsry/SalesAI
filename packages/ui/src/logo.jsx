import { cn } from './cn.js';

/** Shared SalesAI wordmark. */
export function Logo({ className }) {
    return (
        <div className={cn('flex items-center gap-2', className)}>
            <span className="text-[17px] font-bold tracking-tight text-text">
                Sales<span className="text-brand-light">AI</span>
            </span>
        </div>
    );
}
