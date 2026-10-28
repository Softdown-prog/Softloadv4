import React, { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { fetchAppConfig, type AppUser } from '../services/api';

const NAV_LINKS = [
    { href: '/', label: 'Início' },
    { href: '/#solucoes', label: 'Ferramentas' },
    { href: '/#demo-solaris', label: 'Demonstração' },
    { href: '/#como-funciona', label: 'Como funciona' },
    { href: '/contato', label: 'Contato' },
];

export default function PublicNavbar(): React.JSX.Element {
    const [user, setUser] = useState<AppUser | null>(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    const menuButtonRef = useRef<HTMLButtonElement | null>(null);
    const location = useLocation();

    useEffect(() => {
        let mounted = true;
        fetchAppConfig().then((config) => {
            if (mounted && config) setUser(config.user ?? null);
        });
        return () => { mounted = false; };
    }, []);

    // O menu mobile não deve ficar aberto após navegar; Escape o fecha por teclado.
    useEffect(() => { setMobileOpen(false); }, [location.pathname, location.hash]);

    useEffect(() => {
        if (!mobileOpen) return;
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                setMobileOpen(false);
                menuButtonRef.current?.focus();
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [mobileOpen]);

    const loggedIn = !!user;

    return (
        <nav className="navbar navbar-expand-md sl-navbar fixed-top" aria-label="Navegação principal">
            <div className="container-xl">

                <a href="/" className="navbar-brand sl-brand fw-black text-white text-decoration-none me-4">
                    SOFTLOAD<span className="sl-accent"> V4</span>
                </a>

                <div className={`collapse navbar-collapse order-3 order-md-2${mobileOpen ? ' show' : ''}`} id="sl-nav-collapse">
                    <ul className="navbar-nav mx-auto">
                        {NAV_LINKS.map((link) => (
                            <li className="nav-item" key={link.href}>
                                <a href={link.href} className="nav-link" onClick={() => setMobileOpen(false)} aria-current={location.pathname === '/' && link.href === '/' ? 'page' : undefined}>{link.label}</a>
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

                <div className="d-flex align-items-center gap-2 ms-auto order-2 order-md-3">
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
                        ref={menuButtonRef}
                        className="navbar-toggler border-0 p-1 d-md-none"
                        type="button"
                        aria-controls="sl-nav-collapse"
                        aria-expanded={mobileOpen}
                        aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
                        onClick={() => setMobileOpen((open) => !open)}
                    >
                        {mobileOpen ? <X size={26} className="text-white" /> : <Menu size={26} className="text-white" />}
                    </button>
                </div>
            </div>
        </nav>
    );
}
