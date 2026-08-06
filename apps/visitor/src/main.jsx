import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

const Visit = lazy(() => import('./Visit.jsx').then((module) => ({ default: module.Visit })));

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <BrowserRouter>
            <Routes>
                <Route
                    path="/v/:token"
                    element={
                        <Suspense fallback={<div className="app-loading">Connecting...</div>}>
                            <Visit />
                        </Suspense>
                    }
                />
                <Route path="*" element={<div style={{ padding: 32 }}>Invalid link</div>} />
            </Routes>
        </BrowserRouter>
    </StrictMode>
);
