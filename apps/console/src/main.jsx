import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.jsx';
import { ErrorBoundary } from './lib/ErrorBoundary.jsx';
import './i18n/index.js';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </QueryClientProvider>
        </ErrorBoundary>
    </StrictMode>
);
