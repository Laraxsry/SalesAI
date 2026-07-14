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
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Link to="/login">Login</Link>
                    <Link to="/register">Register</Link>
                </div>
            </nav>
            <main style={{ flex: 1, padding: 32 }}>{children}</main>
        </div>
    );
}

export function App() {
    return (
        <Shell>
            <Routes>
                <Route path="/login" element={<h1>Login</h1>} />
                <Route path="/register" element={<h1>Register</h1>} />
                <Route path="/" element={<h1>Overview: Dashboard</h1>} />
                <Route path="/products/:id" element={<h1>Product detail</h1>} />
                <Route path="/knowledge" element={<h1>Knowledge sources</h1>} />
                <Route path="/agents" element={<h1>Agents</h1>} />
                <Route path="/agents/:id" element={<h1>Agent builder</h1>} />
                <Route path="/agents/:id/sessions" element={<h1>Transcripts + analytics</h1>} />
            </Routes>
        </Shell>
    );
}
