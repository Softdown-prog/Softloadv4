import React, { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { fetchAppConfig, type AppUser } from '../services/api';

const NAV_LINKS = [
    { href: '/', label: 'Radar' },
    { href: '/#features', label: 'A Arquitetura' },
    { href: '/contato', label: 'Contato' },
];

export default function PublicNavbar(): React.JSX.Element {
    const [user, setUser] = useState<AppUser | null>(null);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        let mounted = true;
        fetchAppConfig().then((config) => {
            if (mounted && config) setUser(config.user ?? null);
        });
        return () => { mounted = false; };
    }, []);

    const loggedIn = !!user;

    return (
        <nav className="navbar sl-navbar fixed-top">
            <div className="container-xl">

                <a href="/" className="navbar-brand sl-brand fw-black text-white text-decoration-none me-4">
                    SOFTLOAD<span className="sl-accent">ENGINE</span>
                </a>

                <div className={`collapse navbar-collapse${mobileOpen ? ' show' : ''}`} id="sl-nav-collapse">
                    <ul className="navbar-nav mx-auto">
                        {NAV_LINKS.map((link) => (
                            <li className="nav-item" key={link.href}>
                                <a href={link.href} className="nav-link">{link.label}</a>
                            </li>
                        ))}
                    </ul>

                    {/* Botões de auth — mobile expanded */}
                    <div className="d-flex flex-column gap-2 d-md-none mt-3">
                        {loggedIn ? (
                            <>
                                <a href="/dashboard" className="btn btn-sl-primary fw-bold">Painel de Controle</a>
                                <a href="/logout" className="btn btn-outline-secondary fw-bold">Sair</a>
                            </>
                        ) : (
                            <>
                                <a href="/login" className="btn btn-outline-secondary fw-bold">Acessar Conta</a>
                                <a href="/register" className="btn btn-sl-primary fw-bold">Criar Conta</a>
                            </>
                        )}
                    </div>
                </div>

                <div className="d-flex align-items-center gap-2 ms-auto">
                    {loggedIn ? (
                        <a href="/dashboard" className="btn btn-sl-outline btn-sm d-none d-md-inline-flex">Painel de Controle</a>
                    ) : (
                        <>
                            <a href="/login" className="text-decoration-none fw-bold d-none d-md-inline"
                               style={{ color: 'var(--sl-text-300)', fontSize: '0.875rem' }}>Acessar</a>
                            <a href="/register" className="btn btn-sl-primary btn-sm d-none d-md-inline-flex">Criar Conta</a>
                        </>
                    )}

                    <button
                        className="navbar-toggler border-0 p-1 d-md-none"
                        type="button"
                        aria-controls="sl-nav-collapse"
                        aria-expanded={mobileOpen}
                        aria-label="Menu"
                        onClick={() => setMobileOpen((open) => !open)}
                    >
                        <Menu size={28} className="text-white" />
                    </button>
                </div>
            </div>
        </nav>
    );
}
