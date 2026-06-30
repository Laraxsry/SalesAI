import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Visit } from './Visit.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <BrowserRouter>
            <Routes>
                <Route path="/v/:token" element={<Visit />} />
                <Route path="*" element={<div style={{ padding: 32 }}>Invalid link</div>} />
            </Routes>
        </BrowserRouter>
    </StrictMode>
);
