import React, { useCallback, useRef, useState } from 'react';
import { useOutletContext, Link, useSearchParams } from 'react-router-dom';
import { Mail, User, Check, AlertTriangle, UserCircle, CreditCard, Accessibility } from 'lucide-react';
import useFocusTrap from '../hooks/useFocusTrap';
import AcessibilidadeTab from '../components/settings/AcessibilidadeTab';
import type { AppUser } from '../services/api';
import type { LucideIcon } from 'lucide-react';

type SettingsTabId = 'conta' | 'plano' | 'acessibilidade' | 'perigo';
interface SettingsTab {
    value: SettingsTabId;
    label: string;
    icon: LucideIcon;
}
interface SettingsUser extends AppUser {
    email?: string;
}

const TABS: readonly SettingsTab[] = [
    { value: 'conta', label: 'Conta', icon: UserCircle },
    { value: 'plano', label: 'Plano', icon: CreditCard },
    { value: 'acessibilidade', label: 'Acessibilidade', icon: Accessibility },
    { value: 'perigo', label: 'Zona de Perigo', icon: AlertTriangle },
];

export default function Configuracoes(): React.JSX.Element {
    const { user } = useOutletContext<{ user: SettingsUser }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [nome, setNome] = useState(user?.nome || '');
    const [saved, setSaved] = useState(false);
    const [showExcluirModal, setShowExcluirModal] = useState(false);
    const [confirmacao, setConfirmacao] = useState('');
    const excluirFormRef = useRef<HTMLFormElement | null>(null);
    const modalRef = useRef<HTMLDivElement | null>(null);

    const fecharModal = useCallback(() => setShowExcluirModal(false), []);
    useFocusTrap(modalRef, showExcluirModal, fecharModal);

    const erroExclusao = searchParams.get('erro');
    // Se voltamos de uma tentativa de exclusão com erro, abre direto na
    // aba onde a ação mora -- o usuário não deveria precisar navegar de
    // novo até "Zona de Perigo" pra ver por que falhou.
    const tabParam = searchParams.get('tab');
    const abaAtiva = TABS.some((t) => t.value === tabParam) ? tabParam : (erroExclusao ? 'perigo' : 'conta');

    const irParaAba = (value: SettingsTabId): void => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('tab', value);
            next.delete('erro');
            return next;
        });
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    const handleExcluirConta = (e: React.FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        if (confirmacao !== 'EXCLUIR') return;
        excluirFormRef.current?.submit();
    };

    return (
        <div className="sl-dashboard-page p-3 p-md-5" style={{ maxWidth: '800px' }}>
            <div className="sl-dashboard-page-header mb-5">
                <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                    Configurações da Conta
                </h1>
                <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Gerencie suas credenciais, preferências e status da assinatura Softload.</p>
            </div>

            {saved && (
                <div className="alert alert-success d-flex align-items-center gap-2 mb-4" role="alert">
                    <Check size={18} />
                    <span>Configurações atualizadas com sucesso!</span>
                </div>
            )}

            <div className="sl-dashboard-settings-tabs d-flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Seções de configurações">
                {TABS.map((tab) => {
                    const Icon = tab.icon;
                    const ativa = abaAtiva === tab.value;
                    return (
                        <button
                            key={tab.value}
                            type="button"
                            role="tab"
                            aria-selected={ativa}
                            aria-controls={`aba-${tab.value}`}
                            id={`tab-${tab.value}`}
                            onClick={() => irParaAba(tab.value)}
                            className={`btn btn-sm fw-bold d-flex align-items-center gap-2 ${ativa ? 'btn-sl-primary' : 'btn-sl-outline'}`}
                        >
                            <Icon size={15} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {abaAtiva === 'conta' && (
                <div className="sl-card mb-0" role="tabpanel" id="aba-conta" aria-labelledby="tab-conta">
                    <h2 className="fw-bold mb-4 small text-uppercase" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                        Informações Pessoais
                    </h2>
                    <form onSubmit={handleSubmit}>
                        <div className="mb-3">
                            <label htmlFor="config-nome" className="form-label small fw-bold">Nome Completo</label>
                            <div className="input-group">
                                <span className="input-group-text bg-dark text-secondary border-secondary"><User size={16} /></span>
                                <input
                                    id="config-nome"
                                    type="text"
                                    className="form-control bg-dark text-light border-secondary"
                                    value={nome}
                                    onChange={(e) => setNome(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="config-email" className="form-label small fw-bold">E-mail de Acesso</label>
                            <div className="input-group">
                                <span className="input-group-text bg-dark text-secondary border-secondary"><Mail size={16} /></span>
                                <input
                                    id="config-email"
                                    type="email"
                                    className="form-control bg-dark text-light border-secondary"
                                    value={user?.email || ''}
                                    disabled
                                />
                            </div>
                            <div className="form-text text-secondary mt-1" style={{ fontSize: '11px' }}>O e-mail não pode ser alterado diretamente. Contate o suporte se necessário.</div>
                        </div>
                        <button type="submit" className="btn btn-sl-primary btn-sm fw-bold">Salvar Alterações</button>
                    </form>
                </div>
            )}

            {abaAtiva === 'plano' && (
                <div className="sl-card mb-0" role="tabpanel" id="aba-plano" aria-labelledby="tab-plano">
                    <h2 className="fw-bold mb-3 small text-uppercase" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                        Plano e Assinatura
                    </h2>
                    <div className="d-flex align-items-center justify-content-between p-3 bg-dark rounded border border-secondary mb-3">
                        <div>
                            <p className="fw-bold mb-1 text-capitalize">Plano atual: {user?.plano || 'Gratuito'}</p>
                            <p className="small mb-0 text-secondary">
                                {user?.is_active ? 'Assinatura ativa com acesso total aos recursos premium.' : 'Plano gratuito com recursos limitados.'}
                            </p>
                        </div>
                        <Link to="/dashboard/upgrade" className="btn btn-sl-outline btn-sm fw-bold">Gerenciar / Upgrade</Link>
                    </div>
                </div>
            )}

            {abaAtiva === 'acessibilidade' && (
                <div role="tabpanel" id="aba-acessibilidade" aria-labelledby="tab-acessibilidade">
                    <AcessibilidadeTab />
                </div>
            )}

            {abaAtiva === 'perigo' && (
                <div className="sl-card mb-0" style={{ borderColor: 'rgba(239,68,68,.3)' }} role="tabpanel" id="aba-perigo" aria-labelledby="tab-perigo">
                    <h2 className="fw-bold mb-3 small text-uppercase" style={{ letterSpacing: '0.1em', color: '#f87171' }}>
                        Zona de Perigo
                    </h2>
                    <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                        <div>
                            <p className="fw-semibold small mb-1">Excluir minha conta</p>
                            <p className="small mb-0" style={{ color: 'var(--sl-text-400)' }}>Ação irreversível. Todos os seus dados serão permanentemente apagados.</p>
                        </div>
                        <button
                            type="button"
                            className="btn btn-sm btn-danger fw-bold text-uppercase flex-shrink-0"
                            style={{ fontSize: '.72rem', letterSpacing: '.08em' }}
                            onClick={() => setShowExcluirModal(true)}
                        >
                            Excluir
                        </button>
                    </div>

                    {erroExclusao === 'confirmacao' && (
                        <p className="text-danger small fw-semibold mt-3 mb-0">Confirmação inválida. Digite EXCLUIR exatamente.</p>
                    )}
                    {erroExclusao === 'exclusao' && (
                        <p className="text-danger small fw-semibold mt-3 mb-0">Falha ao excluir conta. Tente novamente ou contate o suporte.</p>
                    )}
                </div>
            )}

            {/* Formulário real — o backend responde com um redirect de página inteira,
                não com JSON, então a exclusão precisa ser um POST nativo do navegador. */}
            <form ref={excluirFormRef} method="POST" action="/dashboard/conta/excluir" style={{ display: 'none' }}>
                <input type="hidden" name="confirmacao" value={confirmacao} readOnly />
            </form>

            {showExcluirModal && (
                <div
                    className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-3"
                    style={{ background: 'rgba(0,0,0,.6)', zIndex: 1050 }}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowExcluirModal(false); }}
                >
                    <div
                        ref={modalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="excluir-conta-titulo"
                        className="sl-card mb-0"
                        style={{ maxWidth: '420px', width: '100%', borderRadius: '16px' }}
                    >
                        <div className="d-flex align-items-start justify-content-between mb-2">
                            <h3 id="excluir-conta-titulo" className="fw-black mb-0" style={{ fontSize: '1rem', letterSpacing: '-.01em' }}>
                                Excluir conta permanentemente
                            </h3>
                            <button type="button" className="btn-close" aria-label="Fechar" onClick={() => setShowExcluirModal(false)}></button>
                        </div>
                        <p className="small mb-2" style={{ color: 'var(--sl-text-400)', lineHeight: 1.6 }}>
                            Esta ação é <strong className="text-danger">irreversível</strong>. Seu acesso, dados de plano e histórico serão apagados definitivamente do sistema.
                        </p>
                        <p className="small mb-3" style={{ color: 'var(--sl-text-400)' }}>
                            Para confirmar, digite <strong className="fw-black">EXCLUIR</strong> no campo abaixo:
                        </p>
                        <form onSubmit={handleExcluirConta}>
                            <input
                                type="text"
                                autoComplete="off"
                                autoFocus
                                placeholder="EXCLUIR"
                                className="form-control form-control-sm font-monospace"
                                style={{ letterSpacing: '.1em' }}
                                value={confirmacao}
                                onChange={(e) => setConfirmacao(e.target.value)}
                            />
                            <div className="d-flex align-items-start gap-2 mt-2" style={{ color: '#f87171' }}>
                                <AlertTriangle size={13} className="flex-shrink-0 mt-1" />
                                <span style={{ fontSize: '11px' }}>Todos os templates, sessões e projetos serão perdidos.</span>
                            </div>
                            <div className="d-flex justify-content-end gap-2 mt-4">
                                <button type="button" className="btn btn-sm fw-bold" style={{ background: 'rgba(148,163,184,.12)', color: 'var(--sl-text-300)', border: 0 }} onClick={() => setShowExcluirModal(false)}>
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={confirmacao !== 'EXCLUIR'}
                                    className="btn btn-sm btn-danger fw-bold text-uppercase"
                                    style={{ fontSize: '.7rem', letterSpacing: '.08em', opacity: confirmacao === 'EXCLUIR' ? 1 : .4 }}
                                >
                                    Excluir Definitivamente
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
