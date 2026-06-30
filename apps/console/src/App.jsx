import { Routes, Route, Link } from 'react-router-dom';

function Shell({ children }) {
    return (
        <div style={{ display: 'flex', minHeight: '100vh' }}>
            <nav
                style={{
                    width: 220,
                    padding: 24,
                    background: 'var(--color-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                }}
            >
                <strong style={{ color: 'var(--color-brand)' }}>SalesAI</strong>
                <Link to="/">Overview</Link>
                <Link to="/knowledge">Knowledge</Link>
                <Link to="/agents">Agents</Link>
            </nav>
            <main style={{ flex: 1, padding: 32 }}>{children}</main>
        </div>
    );
}

export function App() {
    return (
        <Shell>
            <Routes>
                <Route path="/" element={<h1>Overview</h1>} />
                <Route path="/knowledge" element={<h1>Knowledge sources</h1>} />
                <Route path="/agents" element={<h1>Agents</h1>} />
            </Routes>
        </Shell>
    );
}
