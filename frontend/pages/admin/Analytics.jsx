import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Zap, MessageSquareText, Users, TrendingUp, TriangleAlert,
    Clipboard, ClipboardCheck, ExternalLink, Inbox
} from 'lucide-react';

const ORDEM_PLANOS = ['studio', 'pro', 'premium', 'starter', 'free'];
const DEPLOY_CMD = 'firebase deploy --only firestore:indexes --project loyal-road-395203';

function fmt(n) {
    return Number(n || 0).toLocaleString('pt-BR');
}

function ordenarPlanos(porPlano) {
    const chaves = Object.keys(porPlano);
    return [
        ...ORDEM_PLANOS.filter(p => chaves.includes(p)),
        ...chaves.filter(p => !ORDEM_PLANOS.includes(p)),
    ];
}

function statusEficiencia(pct) {
    if (pct === 0) return { status: 'Sem dados', cor: 'var(--sl-text-500)', msg: 'Nenhum consumo neste período.' };
    if (pct < 20) return { status: 'Subutilizado', cor: '#34d399', msg: 'Usuários usam pouco — podem estar churning ou ainda explorando.' };
    if (pct < 60) return { status: 'Saudável', cor: '#38bdf8', msg: 'Consumo equilibrado. Ciclo bem dimensionado.' };
    if (pct < 85) return { status: 'Alto uso', cor: '#fbbf24', msg: 'Uso elevado — usuários engajados. Verificar se estão satisfeitos.' };
    return { status: 'Crítico', cor: '#f87171', msg: 'Usuários consumindo >85% do ciclo. Considere aumentar cota.' };
}

const thStyle = {
    fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em',
    color: 'var(--sl-text-500)', padding: '0.75rem 1rem', borderBottom: '1px solid var(--sl-bg-800)',
    whiteSpace: 'nowrap',
};
const tdStyle = { padding: '0.85rem 1rem', verticalAlign: 'middle', fontSize: '0.83rem', fontWeight: 600 };

export default function AdminAnalytics() {
    const [searchParams, setSearchParams] = useSearchParams();
    const dias = parseInt(searchParams.get('dias')) || 30;

    const [analytics, setAnalytics] = useState(null);
    const [semIndice, setSemIndice] = useState(false);
    const [copiado, setCopiado] = useState(false);

    const carregar = useCallback(async (diasAtuais) => {
        try {
            const res = await fetch(`/eu/api/analytics/creditos?dias=${diasAtuais}`);
            const data = await res.json();
            setAnalytics(data);
            setSemIndice(!!data.semIndice);
        } catch (_) {
            setAnalytics({ periodo_dias: diasAtuais, por_plano: {}, gerado_em: new Date().toISOString() });
        }
    }, []);

    useEffect(() => {
        carregar(dias);
        const interval = setInterval(() => carregar(dias), 60000);
        return () => clearInterval(interval);
    }, [dias, carregar]);

    const copiarComando = () => {
        navigator.clipboard.writeText(DEPLOY_CMD).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
        });
    };

    if (!analytics) return null;

    const porPlano = analytics.por_plano || {};
    const planos = ordenarPlanos(porPlano);
    const totalCreditos = planos.reduce((s, p) => s + (porPlano[p].total_creditos_debitados || 0), 0);
    const totalInteracoes = planos.reduce((s, p) => s + (porPlano[p].total_interacoes || 0), 0);
    const totalUsuarios = planos.reduce((s, p) => s + (porPlano[p].usuarios_ativos || 0), 0);
    const mediaGlobal = totalInteracoes > 0 ? (totalCreditos / totalInteracoes).toFixed(2) : '0';

    return (
        <>
            {/* Banner: índice Firestore ausente */}
            {semIndice && (
                <div className="d-flex align-items-start gap-3 mb-4 p-3 rounded-3"
                     style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)' }}>
                    <TriangleAlert size={16} className="flex-shrink-0 mt-1" style={{ color: '#fbbf24' }} />
                    <div style={{ width: '100%' }}>
                        <p className="fw-black mb-2" style={{ color: '#fbbf24', fontSize: '.85rem' }}>Índice Firestore não configurado</p>
                        <p className="mb-2 small" style={{ color: 'var(--sl-text-400)', lineHeight: 1.6 }}>
                            A coleção <code>billing_logs</code> precisa de um índice de <em>collection group</em> em <code>criado_em</code>.
                            O arquivo <code>firestore.indexes.json</code> já está correto — basta implantar via Firebase CLI:
                        </p>
                        <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
                            <code className="px-3 py-2 rounded" style={{ background: 'rgba(0,0,0,.4)', color: '#fde68a', fontSize: '.8rem', flex: 1, minWidth: 0 }}>
                                {DEPLOY_CMD}
                            </code>
                            <button onClick={copiarComando} className="btn btn-sm fw-bold text-uppercase flex-shrink-0 d-flex align-items-center gap-1"
                                    style={{ background: 'rgba(245,158,11,.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,.35)', fontSize: '11px', letterSpacing: '.08em' }}>
                                {copiado ? <ClipboardCheck size={12} /> : <Clipboard size={12} />} Copiar
                            </button>
                        </div>
                        <p className="mb-1 small" style={{ color: 'var(--sl-text-500)' }}>Ou crie manualmente no Firebase Console:</p>
                        <a href="https://console.firebase.google.com/project/loyal-road-395203/firestore/indexes"
                           target="_blank" rel="noopener"
                           className="btn btn-sm fw-bold text-uppercase d-inline-flex align-items-center gap-1"
                           style={{ background: 'rgba(245,158,11,.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,.25)', fontSize: '11px', letterSpacing: '.08em' }}>
                            <ExternalLink size={12} /> Abrir Firebase Console → Firestore → Índices
                        </a>
                    </div>
                </div>
            )}

            {/* Header + filtro de período */}
            <div className="d-flex align-items-start justify-content-between gap-3 mb-4 flex-wrap mt-2">
                <div>
                    <h1 className="fw-bolder text-white text-uppercase mb-1" style={{ fontSize: '1.3rem', letterSpacing: '-.02em' }}>
                        Analytics de Créditos
                    </h1>
                    <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>
                        Consumo real de créditos Gemini por plano · Gerado em {new Date(analytics.gerado_em).toLocaleTimeString('pt-BR')}
                    </p>
                </div>
                <div className="d-flex gap-1">
                    {[7, 30, 90].map(d => (
                        <button
                            key={d}
                            onClick={() => setSearchParams({ dias: String(d) })}
                            className="btn btn-sm fw-bold text-uppercase"
                            style={{
                                fontSize: '10px', letterSpacing: '.08em',
                                background: dias === d ? 'var(--sl-primary)' : 'var(--sl-bg-800)',
                                color: dias === d ? '#fff' : 'var(--sl-text-400)',
                                border: '1px solid var(--sl-bg-800)',
                            }}
                        >
                            {d}d
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI strip */}
            <div className="row g-3 mb-4">
                <div className="col-6 col-lg-3">
                    <div className="kpi-card">
                        <Zap size={18} className="mb-3" style={{ color: 'var(--sl-primary)' }} />
                        <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.6rem', lineHeight: 1 }}>{fmt(totalCreditos)}</p>
                        <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Créditos debitados</p>
                    </div>
                </div>
                <div className="col-6 col-lg-3">
                    <div className="kpi-card">
                        <MessageSquareText size={18} className="mb-3" style={{ color: '#a78bfa' }} />
                        <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.6rem', lineHeight: 1 }}>{fmt(totalInteracoes)}</p>
                        <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Interações totais</p>
                    </div>
                </div>
                <div className="col-6 col-lg-3">
                    <div className="kpi-card">
                        <Users size={18} className="mb-3" style={{ color: '#34d399' }} />
                        <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.6rem', lineHeight: 1 }}>{totalUsuarios}</p>
                        <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Usuários com consumo</p>
                    </div>
                </div>
                <div className="col-6 col-lg-3">
                    <div className="kpi-card">
                        <TrendingUp size={18} className="mb-3" style={{ color: '#fbbf24' }} />
                        <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.6rem', lineHeight: 1 }}>{mediaGlobal}</p>
                        <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Créditos / interação (média)</p>
                    </div>
                </div>
            </div>

            {/* Tabela por plano */}
            <div className="section-card mb-4">
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--sl-bg-800)' }}>
                    <p className="section-label mb-0">Consumo por plano — últimos {dias} dias</p>
                </div>

                {planos.length === 0 ? (
                    <div className="text-center py-5" style={{ color: 'var(--sl-text-500)' }}>
                        <Inbox size={28} />
                        <p className="small mt-2 mb-0">Nenhum billing_log no período.</p>
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="table table-sm mb-0">
                            <thead>
                                <tr>
                                    <th style={thStyle}>Plano</th>
                                    <th style={thStyle}>Usuários ativos</th>
                                    <th className="d-none d-lg-table-cell" style={thStyle}>Interações</th>
                                    <th style={thStyle}>Créditos debitados</th>
                                    <th className="d-none d-lg-table-cell" style={thStyle}>Média / msg</th>
                                    <th className="d-none d-md-table-cell" style={thStyle}>Média / usuário</th>
                                    <th className="d-none d-md-table-cell" style={thStyle}>Ciclo do plano</th>
                                    <th style={{ ...thStyle, minWidth: '160px' }}>% uso do ciclo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {planos.map(plano => {
                                    const p = porPlano[plano];
                                    const pct = p.pct_uso_ciclo;
                                    const barCor = pct >= 80 ? '#f87171' : pct >= 50 ? '#fbbf24' : '#34d399';
                                    return (
                                        <tr key={plano}>
                                            <td style={tdStyle}>
                                                <span className={`plan-badge plan-${plano}`}>{plano.toUpperCase()}</span>
                                            </td>
                                            <td style={{ ...tdStyle, color: '#fff' }}>{p.usuarios_ativos}</td>
                                            <td className="d-none d-lg-table-cell" style={tdStyle}>{fmt(p.total_interacoes)}</td>
                                            <td style={{ ...tdStyle, color: '#fff' }}>
                                                {fmt(p.total_creditos_debitados)}
                                                <span className="d-block" style={{ fontSize: '.68rem', color: 'var(--sl-text-500)', fontWeight: 500 }}>
                                                    ~{(p.total_tokens / 1000).toFixed(0)}K tokens
                                                </span>
                                            </td>
                                            <td className="d-none d-lg-table-cell" style={tdStyle}>
                                                <span style={{ color: p.media_creditos_por_interacao >= 8 ? '#f87171' : 'var(--sl-text-300)' }}>
                                                    {p.media_creditos_por_interacao}
                                                </span>
                                                <span style={{ fontSize: '.68rem', color: 'var(--sl-text-500)' }}> (~{fmt(p.media_tokens_por_interacao)} tokens)</span>
                                            </td>
                                            <td className="d-none d-md-table-cell" style={tdStyle}>
                                                {fmt(p.media_creditos_por_usuario)}
                                                <span style={{ fontSize: '.68rem', color: 'var(--sl-text-500)' }}> créditos/ciclo</span>
                                            </td>
                                            <td className="d-none d-md-table-cell" style={{ ...tdStyle, color: 'var(--sl-text-400)' }}>{fmt(p.creditos_ciclo)}</td>
                                            <td style={tdStyle}>
                                                <div className="d-flex align-items-center gap-2">
                                                    <div className="flex-grow-1" style={{ height: '6px', borderRadius: '3px', background: 'rgba(148,163,184,.12)', overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', borderRadius: '3px', width: `${Math.min(pct, 100)}%`, background: barCor }} />
                                                    </div>
                                                    <span style={{ fontSize: '.75rem', fontWeight: 700, color: barCor, minWidth: '38px', textAlign: 'right' }}>{pct}%</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Eficiência por plano */}
            {planos.length > 0 && (
                <div className="section-card mb-4">
                    <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--sl-bg-800)' }}>
                        <p className="section-label mb-0">Eficiência de créditos — diagnóstico</p>
                    </div>
                    <div className="row g-0">
                        {planos.map((plano, idx) => {
                            const p = porPlano[plano];
                            const { status, cor, msg } = statusEficiencia(p.pct_uso_ciclo);
                            return (
                                <div key={plano} className="col-12 col-md-6 col-xl-3 px-4 py-3"
                                     style={idx < planos.length - 1 ? { borderRight: '1px solid var(--sl-bg-800)' } : {}}>
                                    <div className="d-flex align-items-center gap-2 mb-2">
                                        <span className={`plan-badge plan-${plano}`}>{plano.toUpperCase()}</span>
                                        <span style={{ fontSize: '.7rem', fontWeight: 700, color: cor }}>{status}</span>
                                    </div>
                                    <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.3rem' }}>
                                        {fmt(p.media_creditos_por_usuario)}
                                        <span style={{ fontSize: '.75rem', fontWeight: 500, color: 'var(--sl-text-500)' }}> / {fmt(p.creditos_ciclo)}</span>
                                    </p>
                                    <p className="mb-0" style={{ fontSize: '.7rem', color: 'var(--sl-text-500)', lineHeight: 1.5 }}>{msg}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <p className="text-center small mb-4" style={{ color: 'var(--sl-text-500)' }}>
                <span className="admin-pulse-dot me-1" /> Auto-refresh a cada 60s · Período: últimos {analytics.periodo_dias} dias
            </p>
        </>
    );
}
