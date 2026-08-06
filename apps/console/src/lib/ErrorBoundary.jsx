import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

export class ErrorBoundary extends Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', error, info);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                        <AlertTriangle size={22} />
                    </span>
                    <div>
                        <p className="font-semibold text-text">Bir şeyler ters gitti</p>
                        <p className="mt-1 text-sm text-text-muted">{this.state.error?.message}</p>
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        className="rounded-[var(--radius-input)] bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
                    >
                        Sayfayı yenile
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
