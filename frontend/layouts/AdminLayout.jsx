import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Sun, Users, LineChart, LogOut, Home } from 'lucide-react';
import { fetchAppConfig } from '../services/api';

const NAV = [
    { to: '/eu', label: 'Dashboard', icon: Home },
    { to: '/eu/sol', label: 'Sol', icon: Sun, color: '#fbbf24', bg: 'rgba(251,191,36,.12)', border: 'rgba(251,191,36,.25)' },
    { to: '/eu/usuarios', label: 'Usuários', icon: Users },
    { to: '/eu/analytics', label: 'Analytics', icon: LineChart, color: '#a78bfa', bg: 'rgba(139,92,246,.15)', border: 'rgba(139,92,246,.25)' },
];

export default function AdminLayout() {
    const [config, setConfig] = useState(null);
    const location = useLocation();

    useEffect(() => {
        fetchAppConfig().then(setConfig);
    }, []);

    const user = config?.user || null;
    // /eu/sol é um shell de chat de altura cheia — não faz sentido dentro
    // do container centralizado com padding usado pelas outras páginas
    // do painel (Dashboard/Usuários/Analytics, que são conteúdo rolável).
    const isChatShell = location.pathname === '/eu/sol';

    return (
        <>
            <nav className="admin-topbar">
                <Link to="/eu" className="fw-black text-white text-decoration-none sl-brand" style={{ fontSize: '1rem' }}>
                    SOFTLOAD<span className="sl-accent">ENGINE</span>
                </Link>
                <span className="admin-badge d-none d-sm-inline-block">Admin</span>
                <div className="flex-grow-1"></div>
                {NAV.filter(item => item.to !== location.pathname).map(item => (
                    <Link
                        key={item.to}
                        to={item.to}
                        aria-label={item.label}
                        className="btn btn-sm fw-bold text-uppercase"
                        style={{
                            background: item.bg || 'var(--sl-bg-800)',
                            color: item.color || 'var(--sl-text-300)',
                            border: `1px solid ${item.border || 'var(--sl-bg-800)'}`,
                            letterSpacing: '0.08em',
                            fontSize: '11px',
                        }}
                    >
                        <item.icon size={13} className="me-1" />
                        <span className="d-none d-sm-inline">{item.label}</span>
                    </Link>
                ))}
                <a href="/logout" aria-label="Sair" className="btn btn-sm fw-bold text-uppercase"
                   style={{ background: 'transparent', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', letterSpacing: '0.08em', fontSize: '11px' }}>
                    <LogOut size={13} className="me-1" />
                    <span className="d-none d-sm-inline">Sair</span>
                </a>
            </nav>

            {isChatShell ? (
                <main style={{ paddingTop: '56px', height: '100dvh' }} className="d-flex flex-column">
                    <Outlet context={{ user }} />
                </main>
            ) : (
                <main style={{ paddingTop: '56px' }} className="px-3 px-md-5 py-4">
                    <div className="mx-auto" style={{ maxWidth: '1280px' }}>
                        <Outlet context={{ user }} />
                    </div>
                </main>
            )}
        </>
    );
}
