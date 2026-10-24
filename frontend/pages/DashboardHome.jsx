import React, { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { ShieldCheck, Cpu, FolderOpen, AlertTriangle, MessageSquare, History, Zap, HardDrive, MessageCircle, Settings } from 'lucide-react';
import { fetchAppConfig } from '../services/api';
import Pill from '../components/Pill';

function QuickAccessCard({ to, icon: Icon, iconBg, iconColor, title, badge, badgeTone, desc }) {
    return (
        <div className="col-12 col-md-6">
            <Link to={to} className="sl-card h-100 mb-0 text-decoration-none d-block sl-hover-lift">
                <div className="d-flex align-items-center gap-3 mb-2">
                    <div className="rounded d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '40px', height: '40px', background: iconBg, color: iconColor }}>
                        <Icon size={20} />
                    </div>
                    <h3 className="fw-bold mb-0" style={{ fontSize: '1rem', color: 'var(--bs-body-color)' }}>
                        {title}
                        {badge && <Pill tone={badgeTone} size="sm" className="ms-2">{badge}</Pill>}
                    </h3>
                </div>
                <p className="small mb-0" style={{ color: 'var(--sl-text-400)' }}>{desc}</p>
            </Link>
        </div>
    );
}

export default function DashboardHome() {
    const { user } = useOutletContext();
    const [stats, setStats] = useState(null);

    useEffect(() => {
        fetch('/api/dashboard/stats').then(res => res.json()).then(setStats);
    }, []);

    const firstName = (user?.nome || 'Usuário').split(' ')[0];

    return (
        <div className="p-3 p-md-5">
            {/* Header desktop */}
            <div className="d-none d-lg-flex align-items-start justify-content-between mb-5">
                <div>
                    <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                        Bem-vindo, {firstName}
                    </h1>
                    <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Central de controle do motor Softload.</p>
                </div>
                <Link to="/dashboard/configuracoes" title="Configurações" className="mt-1" style={{ color: 'var(--sl-text-400)', textDecoration: 'none', transition: 'color 0.2s' }}>
                    <svg width="22" height="22" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fillRule="evenodd" clipRule="evenodd" d="M8.625 1.04232C8.54924 0.814981 8.3371 0.65 8.09635 0.65H6.90364C6.66289 0.65 6.45076 0.814981 6.37499 1.04232L6.10811 1.84293C5.69666 1.98403 5.3113 2.1691 4.96024 2.39178L4.22591 1.86532C4.03264 1.72671 3.7663 1.7454 3.59368 1.91802L2.75276 2.75893C2.58014 2.93156 2.56146 3.1979 2.69999 3.39121L3.22656 4.12563C3.00392 4.47665 2.81888 4.86196 2.6778 5.27335L1.87707 5.54024C1.64974 5.616 1.48476 5.82814 1.48476 6.06889V7.2616C1.48476 7.50235 1.64974 7.71449 1.87707 7.79025L2.6778 8.05714C2.81888 8.46853 3.00392 8.85384 3.22656 9.20486L2.69999 9.93928C2.56146 10.1326 2.58014 10.3989 2.75276 10.5716L3.59368 11.4125C3.7663 11.5851 4.03264 11.6038 4.22591 11.4652L4.96024 10.9387C5.3113 11.1614 5.69666 11.3465 6.10811 11.4876L6.37499 12.2882C6.45076 12.5155 6.66289 12.6805 6.90364 12.6805H8.09635C8.3371 12.6805 8.54924 12.5155 8.625 12.2882L8.89188 11.4876C9.30334 11.3465 9.68869 11.1614 10.0397 10.9387L10.7741 11.4652C10.9673 11.6038 11.2337 11.5851 11.4063 11.4125L12.2472 10.5716C12.4198 10.3989 12.4385 10.1326 12.3 9.93928L11.7734 9.20486C11.9961 8.85384 12.1811 8.46853 12.3222 8.05714L13.1229 7.79025C13.3502 7.71449 13.5152 7.50235 13.5152 7.2616V6.06889C13.5152 5.82814 13.3502 5.616 13.1229 5.54024L12.3222 5.27335C12.1811 4.86196 11.9961 4.47665 11.7734 4.12563L12.3 3.39121C12.4385 3.1979 12.4198 2.93156 12.2472 2.75893L11.4063 1.91802C11.2337 1.7454 10.9673 1.72671 10.7741 1.86532L10.0397 2.39178C9.68869 2.1691 9.30334 1.98403 8.89188 1.84293L8.625 1.04232ZM7.49999 9.34049C8.68213 9.34049 9.64049 8.38213 9.64049 7.19999C9.64049 6.01786 8.68213 5.05949 7.49999 5.05949C6.31786 5.05949 5.35949 6.01786 5.35949 7.19999C5.35949 8.38213 6.31786 9.34049 7.49999 9.34049Z" fill="currentColor"/>
                    </svg>
                </Link>
            </div>

            {/* Stats */}
            <div className="row g-3 mb-5 row-cols-xl-5">
                {/* Plano */}
                <div className="col-12 col-md-6 col-xl">
                    <div className="sl-card h-100 mb-0">
                        <div className="d-flex justify-content-between align-items-start mb-3">
                            <ShieldCheck size={18} style={{ color: 'var(--sl-primary)' }} />
                            <span className="fw-bolder text-uppercase font-monospace" style={{ fontSize: '9px', color: 'var(--sl-text-400)', letterSpacing: '0.2em' }}>Plano</span>
                        </div>
                        <p className="fw-bolder mb-1 text-capitalize" style={{ fontSize: '1.1rem' }}>{user?.plano || 'Gratuito'}</p>
                        {user?.is_active && user?.premium_ate && (
                            <p className="small mb-0" style={{ color: 'var(--sl-text-400)' }}>
                                Expira em {new Date(user.premium_ate).toLocaleDateString('pt-BR')}
                            </p>
                        )}
                        <Link to="/dashboard/upgrade" className="btn btn-sl-outline btn-sm w-100 mt-3" style={{ fontSize: '0.75rem' }}>
                            Gerenciar Assinatura
                        </Link>
                    </div>
                </div>

                {stats && (
                    <>
                        <div className="col-12 col-md-6 col-xl">
                            <div className="sl-card h-100 mb-0">
                                <div className="d-flex justify-content-between align-items-start mb-3">
                                    <Zap size={18} style={{ color: '#eab308' }} />
                                    <span className="fw-bolder text-uppercase font-monospace" style={{ fontSize: '9px', color: 'var(--sl-text-400)', letterSpacing: '0.2em' }}>Compilações</span>
                                </div>
                                <p className="fw-bolder mb-1" style={{ fontSize: '1.1rem' }}>{stats.tentativasCompilacao}</p>
                                <p className="small mb-0" style={{ color: 'var(--sl-text-400)' }}>templates gerados no total</p>
                            </div>
                        </div>

                        <div className="col-12 col-md-6 col-xl">
                            <div className="sl-card h-100 mb-0">
                                <div className="d-flex justify-content-between align-items-start mb-3">
                                    <HardDrive size={18} style={{ color: '#a855f7' }} />
                                    <span className="fw-bolder text-uppercase font-monospace" style={{ fontSize: '9px', color: 'var(--sl-text-400)', letterSpacing: '0.2em' }}>Armazenamento</span>
                                </div>
                                <p className="fw-bolder mb-2" style={{ fontSize: '1.1rem' }}>
                                    {stats.storageUsadoMb.toFixed(1)} <span style={{ color: 'var(--sl-text-400)', fontSize: '0.8rem', fontWeight: 500 }}>/ {stats.storageLimitMb} MB</span>
                                </p>
                                <div className="rounded-pill" style={{ height: '4px', background: 'var(--sl-bg-800)' }}>
                                    <div className="rounded-pill" style={{ height: '4px', background: 'var(--sl-primary)', width: `${Math.min((stats.storageUsadoMb / stats.storageLimitMb) * 100, 100)}%` }}></div>
                                </div>
                            </div>
                        </div>

                        <div className="col-12 col-md-6 col-xl">
                            <div className="sl-card h-100 mb-0">
                                <div className="d-flex justify-content-between align-items-start mb-3">
                                    <Cpu size={18} style={{ color: 'var(--sl-primary)' }} />
                                    <span className="fw-bolder text-uppercase font-monospace" style={{ fontSize: '9px', color: 'var(--sl-text-400)', letterSpacing: '0.2em' }}>Créditos Gemini</span>
                                </div>
                                <p className="fw-bolder mb-1" style={{ fontSize: '1.1rem' }}>
                                    {stats.creditos} <span style={{ color: 'var(--sl-text-400)', fontSize: '0.8rem', fontWeight: 500 }}>/ {stats.creditosCicloTotal}</span>
                                </p>
                                {stats.creditosExpiraEm ? (
                                    <p className="small mb-0 text-truncate" style={{ color: 'var(--sl-text-400)' }}>
                                        Renova em {new Date(stats.creditosExpiraEm).toLocaleDateString('pt-BR')}
                                    </p>
                                ) : (
                                    <p className="small mb-0" style={{ color: 'var(--sl-text-400)' }}>Créditos avulsos / sem expiração</p>
                                )}
                            </div>
                        </div>

                        <div className="col-12 col-md-6 col-xl">
                            <div className="sl-card h-100 mb-0">
                                <div className="d-flex justify-content-between align-items-start mb-3">
                                    <FolderOpen size={18} style={{ color: 'var(--sl-primary)' }} />
                                    <span className="fw-bolder text-uppercase font-monospace" style={{ fontSize: '9px', color: 'var(--sl-text-400)', letterSpacing: '0.2em' }}>Projetos</span>
                                </div>
                                <p className="fw-bolder mb-1" style={{ fontSize: '1.1rem' }}>{stats.totalProjetos}</p>
                                <p className="small mb-0" style={{ color: 'var(--sl-text-400)' }}>Projetos salvos no Workspace</p>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Acesso Rápido — agrupado nas mesmas duas categorias já usadas na
                sidebar (Ferramentas / Conta, ver DashboardLayout.jsx), em vez
                de uma lista única sem hierarquia. */}
            <div className="row g-4">
                <div className="col-12 col-lg-8">
                    <h2 className="fw-black text-uppercase mb-4" style={{ fontSize: '0.85rem', letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                        Ferramentas de IA
                    </h2>
                    <div className="row g-3 mb-5">
                        <QuickAccessCard
                            to="/dashboard/chat" icon={MessageSquare}
                            iconBg="rgba(14,165,233,.1)" iconColor="var(--sl-primary)"
                            title="Especialista Blogger"
                            desc="Suporte técnico, snippets CSS/JS adaptados ao seu template, SEO e AdSense com IA especializada."
                        />
                        <QuickAccessCard
                            to="/dashboard/solaris" icon={Cpu}
                            iconBg="rgba(99,102,241,.1)" iconColor="#818cf8"
                            title="Solaris Code" badge="NOVO" badgeTone="indigo"
                            desc="Engenharia guiada por IA. Descreva o que você precisa e gere templates em segundos."
                        />
                    </div>

                    <h2 className="fw-black text-uppercase mb-4" style={{ fontSize: '0.85rem', letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                        Conta &amp; Projetos
                    </h2>
                    <div className="row g-3">
                        <QuickAccessCard
                            to="/dashboard/workspace" icon={FolderOpen}
                            iconBg="rgba(99,102,241,.1)" iconColor="#818cf8"
                            title="Abrir Workspace"
                            desc="Acesse seus projetos salvos, continue de onde parou e baixe o código final."
                        />
                        <QuickAccessCard
                            to="/dashboard/historico" icon={History}
                            iconBg="rgba(14,165,233,.1)" iconColor="var(--sl-primary)"
                            title="Histórico de Compilações"
                            desc="Acesse e baixe novamente todos os templates que você já compilou."
                        />
                        <QuickAccessCard
                            to="/dashboard/configuracoes" icon={Settings}
                            iconBg="rgba(148,163,184,.12)" iconColor="var(--sl-text-400)"
                            title="Configurações"
                            desc="Dados da conta, plano atual e opções de assinatura."
                        />
                    </div>
                </div>

                {/* Dicas */}
                <div className="col-12 col-lg-4">
                    <h2 className="fw-black text-uppercase mb-4" style={{ fontSize: '0.85rem', letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                        Documentação
                    </h2>
                    <div className="sl-card bg-transparent" style={{ border: '1px dashed var(--bs-border-color)' }}>
                        <div className="d-flex align-items-start gap-3">
                            <AlertTriangle size={18} style={{ color: 'var(--sl-text-400)', marginTop: '2px' }} />
                            <div>
                                <h4 className="fw-bold mb-1" style={{ fontSize: '0.9rem' }}>Guias e Tutoriais</h4>
                                <p className="small mb-3" style={{ color: 'var(--sl-text-400)' }}>Aprenda as melhores práticas para extrair o máximo do motor de templates e da IA.</p>
                                <a href="https://suporte.analysepro.com" target="_blank" rel="noopener noreferrer" className="btn btn-sl-outline btn-sm fw-bold">Acessar Blog</a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
