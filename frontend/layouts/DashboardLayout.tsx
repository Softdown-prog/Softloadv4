import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
    LayoutDashboard,
    MessageSquare,
    Cpu,
    FolderOpen,
    History,
    Settings,
    LogOut,
    ShieldCheck,
    Menu,
    X
} from 'lucide-react';
import { fetchAppConfig, type AppConfig, type AppUser } from '../services/api';
import type { LucideIcon } from 'lucide-react';
import useFocusTrap from '../hooks/useFocusTrap';
import Pill from '../components/Pill';

interface SidebarItemProps {
    to: string;
    icon: LucideIcon;
    label: string;
    badge?: string;
    badgeColor?: 'primary' | 'secondary';
    active: boolean;
    onNavigate?: () => void;
}
function SidebarItem({ to, icon: Icon, label, badge, badgeColor, active, onNavigate }: SidebarItemProps): React.JSX.Element {
    return (
        <Link to={to} aria-current={active ? 'page' : undefined} className={`sl-nav-item ${active ? 'active' : ''}`} onClick={onNavigate}>
            <span className="sl-nav-label">
                <Icon size={18} className="sl-nav-icon me-2" />
                {label}
            </span>
            {badge && <Pill tone={badgeColor === 'primary' ? 'primary' : 'indigo'}>{badge}</Pill>}
        </Link>
    );
}

// Conteúdo da navegação, compartilhado entre a sidebar fixa (desktop) e o
// drawer (mobile/tablet) — mesma lista de itens, só o container muda.
interface SidebarContentProps {
    user: AppUser;
    location: { pathname: string };
    onNavigate?: () => void;
    onClose?: () => void;
}
function SidebarContent({ user, location, onNavigate, onClose }: SidebarContentProps): React.JSX.Element {
    const firstLetter = (user.nome || 'U').charAt(0).toUpperCase();

    return (
        <>
            {/* Logo */}
            <div className="d-flex align-items-center justify-content-between px-4 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
                <div>
                    <Link to="/dashboard" className="fw-black text-decoration-none sl-brand d-block" style={{ fontSize: '1.05rem', color: 'var(--bs-body-color)' }}>
                        SOFTLOAD<span className="sl-accent">ENGINE</span>
                    </Link>
                    <p className="mb-0 text-uppercase font-monospace" style={{ fontSize: '9px', color: 'var(--sl-text-400)', letterSpacing: '0.25em', marginTop: '2px' }}>
                        Fábrica de Templates XML
                    </p>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        aria-label="Fechar menu"
                        className="btn btn-link p-1 flex-shrink-0"
                        style={{ color: 'var(--bs-body-color)' }}
                    >
                        <X size={20} />
                    </button>
                )}
            </div>

            {/* User Info */}
            <div className="sl-dashboard-identity px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
                <div className="d-flex align-items-center gap-3">
                    <div className="rounded-3 d-flex align-items-center justify-content-center text-white fw-black flex-shrink-0"
                         style={{ width: '36px', height: '36px', background: 'linear-gradient(135deg,#0ea5e9,#2563eb)', fontSize: '14px' }}>
                        {firstLetter}
                    </div>
                    <div className="overflow-hidden">
                        <p className="mb-0 fw-bold small text-truncate">{user.nome || 'Usuário'}</p>
                        <span className="d-inline-flex align-items-center gap-1 fw-black text-uppercase"
                              style={{ fontSize: '9px', letterSpacing: '0.15em', color: user.is_active ? 'var(--sl-primary)' : 'var(--sl-text-400)' }}>
                            <span className={`rounded-circle ${user.is_active ? 'sl-pulse' : ''}`}
                                  style={{ width: '6px', height: '6px', background: user.is_active ? 'var(--sl-primary)' : '#94a3b8', display: 'inline-block', flexShrink: 0 }}></span>
                            {user.is_active ? 'Premium' : 'Gratuito'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="sl-dashboard-nav flex-grow-1 px-3 py-3" aria-label="Navegação do painel" style={{ overflowY: 'auto' }}>
                <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Visão geral" active={location.pathname === '/dashboard' || location.pathname === '/dashboard/'} onNavigate={onNavigate} />
                <p className="fw-black text-uppercase mb-2 px-2 mt-3" style={{ fontSize: '9px', letterSpacing: '0.3em', color: 'var(--sl-text-400)' }}>Ferramentas</p>
                <SidebarItem to="/dashboard/chat" icon={MessageSquare} label="Especialista Blogger" badge="Gemini" badgeColor="primary" active={location.pathname === '/dashboard/chat'} onNavigate={onNavigate} />
                <SidebarItem to="/dashboard/solaris" icon={Cpu} label="Solaris Code" badge="Novo" badgeColor="secondary" active={location.pathname === '/dashboard/solaris'} onNavigate={onNavigate} />

                <p className="fw-black text-uppercase mb-2 px-2 mt-4" style={{ fontSize: '9px', letterSpacing: '0.3em', color: 'var(--sl-text-400)' }}>Conta</p>
                <SidebarItem to="/dashboard/workspace" icon={FolderOpen} label="Workspace" active={location.pathname === '/dashboard/workspace' || location.pathname.startsWith('/dashboard/workspace/')} onNavigate={onNavigate} />
                <SidebarItem to="/dashboard/historico" icon={History} label="Histórico XML" active={location.pathname === '/dashboard/historico'} onNavigate={onNavigate} />
                <SidebarItem to="/dashboard/configuracoes" icon={Settings} label="Configurações" active={location.pathname === '/dashboard/configuracoes'} onNavigate={onNavigate} />
            </nav>

            {/* Logout */}
            <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--bs-border-color)' }}>
                <a href="/logout" className="sl-nav-item text-danger" style={{ color: '#f87171' }}>
                    <span className="sl-nav-label">
                        <LogOut size={18} className="sl-nav-icon me-2" />
                        Encerrar Sessão
                    </span>
                </a>
            </div>
        </>
    );
}

export default function DashboardLayout(): React.JSX.Element | null {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const location = useLocation();
    const drawerRef = useRef<HTMLElement | null>(null);

    const fecharDrawer = useCallback(() => setDrawerOpen(false), []);
    useFocusTrap(drawerRef, drawerOpen, fecharDrawer);

    useEffect(() => {
        fetchAppConfig().then(setConfig);
    }, []);

    // Fecha o drawer automaticamente ao navegar (troca de rota) — evita
    // que ele fique aberto sobre a próxima página depois de um clique.
    useEffect(() => {
        setDrawerOpen(false);
    }, [location.pathname]);

    if (!config) return null; // or a minimal loading state

    const user = config.user || { nome: 'Usuário', is_active: false, plano: 'Gratuito' };

    const mobileSectionLabel = location.pathname.startsWith('/dashboard/workspace/chat') ? 'Editor do Workspace'
        : location.pathname.startsWith('/dashboard/workspace') ? 'Workspace'
        : location.pathname.startsWith('/dashboard/solaris') ? 'Solaris Code'
        : location.pathname.startsWith('/dashboard/chat') ? 'Especialista Blogger'
        : location.pathname.startsWith('/dashboard/historico') ? 'Histórico'
        : location.pathname.startsWith('/dashboard/configuracoes') ? 'Configurações'
        : location.pathname.startsWith('/dashboard/upgrade') ? 'Assinatura'
        : 'Visão geral';
    return (
        <div className="sl-dash-wrapper" style={{ display: 'flex' }}>
            {/* Sidebar Desktop */}
            <aside id="sl-dash-sidebar" className="sl-sidebar sl-dashboard-sidebar d-none d-lg-flex flex-column" style={{ width: '260px', borderRight: '1px solid var(--bs-border-color)' }}>
                <SidebarContent user={user} location={location} />
            </aside>

            {/* Drawer mobile/tablet — mesma navegação da sidebar, acessível
                abaixo de 992px (breakpoint em que a sidebar fixa some). */}
            <AnimatePresence>
                {drawerOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setDrawerOpen(false)}
                            className="position-fixed top-0 start-0 w-100 h-100 bg-black bg-opacity-50 d-lg-none"
                            style={{ zIndex: 1040 }}
                        />
                        <motion.aside
                            ref={drawerRef}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Menu de navegação"
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'tween', duration: 0.25 }}
                            className="sl-sidebar sl-dashboard-sidebar d-lg-none d-flex flex-column position-fixed top-0 start-0 h-100"
                            style={{ width: 'min(280px, 85vw)', zIndex: 1050, boxShadow: '4px 0 24px rgba(0,0,0,0.3)' }}
                        >
                            <SidebarContent user={user} location={location} onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>

            {/* Main Content Area */}
            <main className="sl-dashboard-main flex-grow-1 overflow-auto d-flex flex-column" style={{ minWidth: 0 }}>
                {/* Topbar mobile */}
                <div className="sl-topbar sl-dashboard-mobile-topbar d-lg-none d-flex align-items-center gap-2" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
                    <button
                        onClick={() => setDrawerOpen(true)}
                        className="btn btn-link p-1"
                        style={{ color: 'var(--bs-body-color)' }}
                        aria-label="Abrir menu"
                    >
                        <Menu size={20} />
                    </button>
                    <span className="sl-dashboard-mobile-title flex-grow-1 fw-bolder text-truncate">{mobileSectionLabel}</span>
                    <Link to="/dashboard/configuracoes" title="Configurações" aria-label="Abrir configurações" className="btn btn-link p-1" style={{ color: 'var(--sl-text-400)' }}>
                        <Settings size={20} />
                    </Link>
                </div>

                {/* Pages render here */}
                <Outlet context={{ user }} />
            </main>
        </div>
    );
}
