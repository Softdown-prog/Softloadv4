import React, { useEffect, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
    Users, ShieldCheck, HardDrive, Zap, Box, ExternalLink,
    ShieldAlert, Bug, RefreshCw, Stars, CircleCheckBig, CircleX,
} from 'lucide-react';
import DonutChart from '../../components/admin/DonutChart';
import type { AppUser } from '../../services/api';
interface AdminKpis { totalUsuarios: number; totalPremium: number; totalFree: number; receitaEstimada: number | string; storageTotal: number; compilacoesTotal: number; expirando7dias: number }
interface AdminApiStatus { chave: boolean; modelo?: string; uso?: string; status?: string }
interface AdminHealth {
    deploy?: { gitSha: string; gitDate?: string; buildTime?: string };
    apis: Record<string, AdminApiStatus | undefined>;
    ambiente?: string;
}
interface AdminAuditLog {
    id: string;
    tipo: string;
    criado_em?: string;
    detalhes?: { email_alvo?: string; plano?: string; gemini?: number; gpt?: number; categoria?: string; erro?: string };
}
interface AdminRecentUser { email: string; nome?: string; is_active: boolean; criado_em?: string }
interface AdminUser extends AppUser { email?: string }

const TIPO_LABELS: Record<string, { label: string; cor: string }> = {
    plano_ativado: { label: 'Plano ativado', cor: '#4ade80' },
    plano_revogado: { label: 'Plano revogado', cor: '#f87171' },
    creditos_atualizados: { label: 'Créditos', cor: '#fbbf24' },
    erro_gpt: { label: 'Erro de integração antiga', cor: '#fb923c' },
    erro_gemini: { label: 'Erro Gemini', cor: '#fb923c' },
};

const APIS_SAUDE = [
    { nome: 'Gemini Flash', key: 'gemini_flash', icon: Stars, cor: '#60a5fa' },
    { nome: 'Gemini Lite', key: 'gemini_lite', icon: Zap, cor: '#34d399' },
];

function fmtDataHora(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminDashboard(): React.JSX.Element {
    const { user } = useOutletContext<{ user: AdminUser }>();
    const [kpis, setKpis] = useState<AdminKpis | null>(null);
    const [recentes, setRecentes] = useState<AdminRecentUser[]>([]);
    const [saude, setSaude] = useState<AdminHealth | null>(null);
    const [logs, setLogs] = useState<AdminAuditLog[] | null>(null);
    const [logsLoading, setLogsLoading] = useState(true);

    const carregarKpis = useCallback(async () => {
        try {
            const res = await fetch('/eu/api/kpis');
            if (res.ok) setKpis(await res.json());
        } catch (_) {}
    }, []);

    const carregarSaude = useCallback(async () => {
        try {
            const res = await fetch('/eu/api/saude');
            if (res.ok) setSaude(await res.json());
        } catch (_) {}
    }, []);

    const carregarLogs = useCallback(async () => {
        setLogsLoading(true);
        try {
            const res = await fetch('/eu/api/logs?limit=20');
            const data = await res.json() as { logs?: AdminAuditLog[] };
            setLogs(data.logs || []);
        } catch (_) {
            setLogs(null);
        } finally {
            setLogsLoading(false);
        }
    }, []);

    useEffect(() => {
        carregarKpis();
        carregarSaude();
        carregarLogs();

        (async () => {
            try {
                const res = await fetch('/eu/api/usuarios?limit=10');
                const data = await res.json() as { usuarios?: AdminRecentUser[] };
                setRecentes(data.usuarios || []);
            } catch (_) {}
        })();

        const iKpis = setInterval(carregarKpis, 30000);
        const iSaude = setInterval(carregarSaude, 60000);
        const iLogs = setInterval(carregarLogs, 30000);
        return () => { clearInterval(iKpis); clearInterval(iSaude); clearInterval(iLogs); };
    }, [carregarKpis, carregarSaude, carregarLogs]);

    const conversao = kpis && kpis.totalUsuarios > 0
        ? ((kpis.totalPremium / kpis.totalUsuarios) * 100).toFixed(1)
        : '0';

    return (
        <>
            {/* Header */}
            <div className="mb-4 mt-2">
                <h1 className="fw-bolder text-white text-uppercase mb-1" style={{ fontSize: '1.5rem', letterSpacing: '-0.02em' }}>Painel de Controle</h1>
                <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>
                    Visão geral do sistema · Operador: <span style={{ color: 'var(--sl-primary)' }}>{user?.email}</span>
                </p>
            </div>

            {/* KPI Cards */}
            {kpis && (
                <div className="row g-3 mb-4">
                    <div className="col-6 col-lg-3">
                        <div className="kpi-card">
                            <div className="d-flex justify-content-between align-items-start mb-3">
                                <Users size={20} style={{ color: 'var(--sl-primary)' }} />
                                <span className="admin-badge">Total</span>
                            </div>
                            <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.5rem' }}>{kpis.totalUsuarios}</p>
                            <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Usuários cadastrados</p>
                        </div>
                    </div>
                    <div className="col-6 col-lg-3">
                        <div className="kpi-card">
                            <div className="d-flex justify-content-between align-items-start mb-3">
                                <ShieldCheck size={20} style={{ color: '#22c55e' }} />
                                <span className="admin-badge">Premium</span>
                            </div>
                            <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.5rem' }}>{kpis.totalPremium}</p>
                            <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Receita est. R$ {kpis.receitaEstimada}</p>
                        </div>
                    </div>
                    <div className="col-6 col-lg-3">
                        <div className="kpi-card">
                            <div className="d-flex justify-content-between align-items-start mb-3">
                                <HardDrive size={20} style={{ color: '#a855f7' }} />
                                <span className="admin-badge">Storage</span>
                            </div>
                            <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.5rem' }}>
                                {kpis.storageTotal} <span className="fw-normal small" style={{ color: 'var(--sl-text-500)' }}>MB</span>
                            </p>
                            <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Uso total no GCS</p>
                        </div>
                    </div>
                    <div className="col-6 col-lg-3">
                        <div className="kpi-card">
                            <div className="d-flex justify-content-between align-items-start mb-3">
                                <Zap size={20} style={{ color: '#eab308' }} />
                                <span className="admin-badge">Compilações</span>
                            </div>
                            <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.5rem' }}>{kpis.compilacoesTotal}</p>
                            <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>
                                {kpis.expirando7dias > 0
                                    ? <span style={{ color: '#eab308', fontWeight: 700 }}>{kpis.expirando7dias} expira em 7 dias</span>
                                    : 'Templates gerados no total'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Deploy em produção */}
            {saude?.deploy && (
                <div className="row g-3 mb-4">
                    <div className="col-12">
                        <div className="d-flex align-items-center justify-content-between flex-wrap gap-3"
                             style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid var(--sl-bg-800)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                            <div className="d-flex align-items-center gap-3">
                                <Box size={20} style={{ color: '#38bdf8' }} />
                                <div>
                                    <p className="mb-0 fw-bolder text-white" style={{ fontSize: '.875rem' }}>
                                        Deploy em produção
                                        {saude.deploy.gitSha === 'dev-local' && (
                                            <span className="status-badge status-free ms-1">Rodando local</span>
                                        )}
                                    </p>
                                    <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>
                                        commit <code style={{ color: '#38bdf8' }}>{saude.deploy.gitSha}</code>
                                        {saude.deploy.gitDate && <> · commitado em {fmtDataHora(saude.deploy.gitDate)}</>}
                                        {saude.deploy.buildTime && <> · imagem buildada em {fmtDataHora(saude.deploy.buildTime)}</>}
                                    </p>
                                </div>
                            </div>
                            <a href={`https://github.com/Softdown-prog/softload-engine-v3/commit/${saude.deploy.gitSha}`}
                               target="_blank" rel="noopener" className="workers-link flex-shrink-0"
                               style={saude.deploy.gitSha === 'dev-local' ? { pointerEvents: 'none', opacity: .4 } : undefined}>
                                <ExternalLink size={13} /> Ver commit
                            </a>
                        </div>
                    </div>
                </div>
            )}

            {/* Links rápidos: Workers */}
            <div className="row g-3 mb-4">
                <div className="col-12 col-md-6">
                    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 h-100"
                         style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid var(--sl-bg-800)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                        <div className="d-flex align-items-center gap-3">
                            <ShieldAlert size={20} style={{ color: '#a855f7' }} />
                            <div>
                                <p className="mb-0 fw-bolder text-white" style={{ fontSize: '.875rem' }}>Sentinel Monitor</p>
                                <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Saúde, memória e diagnósticos</p>
                            </div>
                        </div>
                        <a href="/workers" className="workers-link flex-shrink-0">Abrir →</a>
                    </div>
                </div>
                <div className="col-12 col-md-6">
                    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 h-100"
                         style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(239,68,68,.2)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                        <div className="d-flex align-items-center gap-3">
                            <Bug size={20} style={{ color: '#f87171' }} />
                            <div>
                                <p className="mb-0 fw-bolder text-white" style={{ fontSize: '.875rem' }}>Error Log 24h</p>
                                <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Monitoramento automático do SaaS</p>
                            </div>
                        </div>
                        <a href="/workerlog" style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.1em', color: '#f87171', textDecoration: 'none' }} className="flex-shrink-0">Abrir →</a>
                    </div>
                </div>
            </div>

            {/* Gráficos */}
            {kpis && (
                <div className="row g-4 mb-4">
                    <div className="col-12 col-lg-6">
                        <div className="section-card p-4">
                            <p className="section-label mb-4">Distribuição de Planos</p>
                            <div className="d-flex align-items-center justify-content-center" style={{ height: '220px' }}>
                                <DonutChart data={[
                                    { label: 'Premium', value: kpis.totalPremium, color: 'rgba(34,197,94,0.8)', border: 'rgba(34,197,94,1)' },
                                    { label: 'Free', value: kpis.totalFree, color: 'rgba(71,85,105,0.6)', border: 'rgba(71,85,105,1)' },
                                ]} />
                            </div>
                        </div>
                    </div>
                    <div className="col-12 col-lg-6">
                        <div className="section-card p-4">
                            <p className="section-label mb-3">Resumo Financeiro</p>
                            <div className="finance-row">
                                <span className="small" style={{ color: 'var(--sl-text-400)' }}>Usuários Premium</span>
                                <span className="fw-bolder text-white small">{kpis.totalPremium}</span>
                            </div>
                            <div className="finance-row">
                                <span className="small" style={{ color: 'var(--sl-text-400)' }}>Usuários Free</span>
                                <span className="fw-bolder text-white small">{kpis.totalFree}</span>
                            </div>
                            <div className="finance-row">
                                <span className="small" style={{ color: 'var(--sl-text-400)' }}>Receita Estimada Mensal</span>
                                <span className="fw-bolder small" style={{ color: '#4ade80' }}>R$ {kpis.receitaEstimada}</span>
                            </div>
                            <div className="finance-row" style={{ borderBottom: kpis.expirando7dias > 0 ? undefined : 'none' }}>
                                <span className="small" style={{ color: 'var(--sl-text-400)' }}>Taxa de Conversão</span>
                                <span className="fw-bolder small" style={{ color: 'var(--sl-primary-light)' }}>{conversao}%</span>
                            </div>
                            {kpis.expirando7dias > 0 && (
                                <div className="finance-row" style={{ borderBottom: 'none' }}>
                                    <span className="small" style={{ color: 'var(--sl-text-400)' }}>Expirando em 7 dias</span>
                                    <span className="fw-bolder small" style={{ color: '#eab308' }}>{kpis.expirando7dias}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Saúde das APIs + Auditoria Recente */}
            <div className="row g-3 mb-4">
                <div className="col-12 col-lg-5">
                    <div className="section-card h-100">
                        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--sl-bg-800)' }}>
                            <p className="section-label mb-0">Saúde das APIs de IA</p>
                        </div>
                        <div className="px-4 py-3">
                            {!saude ? (
                                <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Carregando...</p>
                            ) : (
                                <>
                                    {APIS_SAUDE.map(a => {
                                        const info = saude.apis[a.key];
                                        const ok = info && info.chave;
                                        const StatusIcon = ok ? CircleCheckBig : CircleX;
                                        const statusColor = ok ? '#4ade80' : '#f87171';
                                        return (
                                            <div key={a.key} className="d-flex align-items-start gap-3 py-2" style={{ borderBottom: '1px solid var(--sl-bg-800)' }}>
                                                <a.icon size={15} className="mt-1 flex-shrink-0" style={{ color: a.cor }} />
                                                <div className="flex-grow-1 overflow-hidden">
                                                    <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                                                        <span className="fw-bold text-white" style={{ fontSize: '.8rem' }}>{a.nome}</span>
                                                        <code style={{ fontSize: '9px', color: 'var(--sl-text-500)' }}>{info ? info.modelo : '—'}</code>
                                                        {info?.uso && <span style={{ fontSize: '9px', color: 'var(--sl-text-600)' }}>{info.uso}</span>}
                                                    </div>
                                                    <div className="d-flex align-items-center gap-1">
                                                        <StatusIcon size={11} style={{ color: statusColor }} />
                                                        <span style={{ fontSize: '11px', color: statusColor }}>{ok ? 'Chave configurada' : (info ? info.status : 'indisponível')}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div className="pt-2"><span style={{ fontSize: '10px', color: 'var(--sl-text-500)' }}>Ambiente: {saude.ambiente || '—'}</span></div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="col-12 col-lg-7">
                    <div className="section-card h-100">
                        <div className="d-flex align-items-center justify-content-between px-4 py-3" style={{ borderBottom: '1px solid var(--sl-bg-800)' }}>
                            <p className="section-label mb-0">Auditoria Recente</p>
                            <button onClick={carregarLogs} className="btn btn-sm"
                                    style={{ background: 'transparent', color: 'var(--sl-text-500)', border: '1px solid var(--sl-bg-800)', fontSize: '10px', letterSpacing: '.08em', fontWeight: 700, textTransform: 'uppercase' }}>
                                <RefreshCw size={12} />
                            </button>
                        </div>
                        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                            {logsLoading && !logs ? (
                                <p className="small px-4 py-3 mb-0" style={{ color: 'var(--sl-text-500)' }}>Carregando...</p>
                            ) : !logs ? (
                                <p className="small px-4 py-3 mb-0" style={{ color: '#f87171' }}>Erro ao carregar auditoria.</p>
                            ) : logs.length === 0 ? (
                                <p className="small px-4 py-3 mb-0" style={{ color: 'var(--sl-text-500)' }}>Nenhuma ação registrada ainda.</p>
                            ) : (
                                logs.map(l => {
                                    const meta = TIPO_LABELS[l.tipo] || { label: l.tipo, cor: 'var(--sl-text-400)' };
                                    const alvo = l.detalhes?.email_alvo || '';
                                    let extras = '';
                                    if (l.tipo === 'plano_ativado' && l.detalhes?.plano) extras = ` → ${l.detalhes.plano}`;
                                    if (l.tipo === 'creditos_atualizados') {
                                        const g = l.detalhes?.gemini, p = l.detalhes?.gpt;
                                        if (g != null) extras += ` Gem=${g}`;
                                        if (p != null) extras += ` Avançada=${p}`;
                                    }
                                    if (l.tipo === 'erro_gpt' || l.tipo === 'erro_gemini') {
                                        extras = ` — ${l.detalhes?.categoria || ''}: ${(l.detalhes?.erro || '').slice(0, 60)}`;
                                    }
                                    const ts = l.criado_em ? new Date(l.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                                    return (
                                        <div key={l.id} className="d-flex align-items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid rgba(30,41,59,0.6)' }}>
                                            <span style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.08em', color: meta.cor, whiteSpace: 'nowrap', minWidth: '90px' }}>{meta.label}</span>
                                            <span className="text-white fw-semibold text-truncate" style={{ fontSize: '11px', flex: 1 }}>{alvo}{extras}</span>
                                            <span style={{ fontSize: '10px', color: 'var(--sl-text-500)', whiteSpace: 'nowrap' }}>{ts}</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabela: últimas contas */}
            <div className="section-card">
                <div className="d-flex align-items-center justify-content-between px-4 py-3" style={{ borderBottom: '1px solid var(--sl-bg-800)' }}>
                    <p className="section-label mb-0">Últimas Contas Criadas</p>
                    <a href="/eu/usuarios" className="fw-bolder text-uppercase text-decoration-none" style={{ fontSize: '10px', color: 'var(--sl-primary)', letterSpacing: '0.08em' }}>Ver todos →</a>
                </div>
                {recentes.length === 0 ? (
                    <div className="px-4 py-5 text-center">
                        <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Nenhum usuário cadastrado.</p>
                    </div>
                ) : (
                    recentes.map((u, idx) => (
                        <div key={u.email} className="d-flex align-items-center justify-content-between gap-3 flex-wrap px-4 py-3"
                             style={idx < recentes.length - 1 ? { borderBottom: '1px solid rgba(30,41,59,0.6)' } : undefined}>
                            <div className="d-flex align-items-center gap-3 overflow-hidden">
                                <div className="d-flex align-items-center justify-content-center fw-bolder flex-shrink-0"
                                     style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--sl-bg-800)', color: 'var(--sl-text-400)', fontSize: '12px' }}>
                                    {(u.nome || '—').charAt(0).toUpperCase()}
                                </div>
                                <div className="overflow-hidden">
                                    <p className="fw-semibold text-white mb-0 text-truncate small">{u.email}</p>
                                    <p className="mb-0" style={{ fontSize: '10px', color: 'var(--sl-text-500)' }}>{u.nome} · {u.criado_em}</p>
                                </div>
                            </div>
                            <span className={`status-badge flex-shrink-0 ${u.is_active ? 'status-premium' : 'status-free'}`}>
                                {u.is_active ? 'Premium' : 'Free'}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </>
    );
}
