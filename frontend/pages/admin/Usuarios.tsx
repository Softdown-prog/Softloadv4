import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Coins, ArrowDownCircle, Info } from 'lucide-react';
import useFocusTrap from '../../hooks/useFocusTrap';
type PremiumPlan = 'starter' | 'pro' | 'studio';
interface AdminAccount { email: string; nome: string; is_active: boolean; plano?: string; storage_usado_mb?: number; creditos?: number; criado_em?: string }
interface AdminToast { msg: string; erro: boolean }
interface SelectedAccount { email: string }

const PLANO_INFO: Record<PremiumPlan, { gemini: number; label: string }> = {
    starter: { gemini: 500, label: 'Starter' },
    pro: { gemini: 2000, label: 'Pro' },
    studio: { gemini: 5500, label: 'Studio' },
};

function planoBadgeClass(plano?: string): string {
    if (plano === 'studio') return 'plan-studio';
    if (plano === 'pro') return 'plan-pro';
    if (plano === 'starter') return 'plan-starter';
    return 'plan-free';
}

export default function AdminUsuarios(): React.JSX.Element {
    const [todos, setTodos] = useState<AdminAccount[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroPlano, setFiltroPlano] = useState('');
    const [toast, setToast] = useState<AdminToast | null>(null); // { msg, erro }

    const [modalAtivar, setModalAtivar] = useState<SelectedAccount | null>(null); // { email }
    const [planoEscolhido, setPlanoEscolhido] = useState<PremiumPlan>('pro');
    const [ativando, setAtivando] = useState(false);

    const [modalCreditos, setModalCreditos] = useState<SelectedAccount | null>(null); // { email, gemini }
    const [inputGemini, setInputGemini] = useState('');
    const [salvandoCreditos, setSalvandoCreditos] = useState(false);

    const [revogandoEmail, setRevogandoEmail] = useState<string | null>(null);

    const modalAtivarRef = useRef<HTMLDivElement | null>(null);
    const modalCreditosRef = useRef<HTMLDivElement | null>(null);
    const fecharModalAtivar = useCallback(() => setModalAtivar(null), []);
    const fecharModalCreditos = useCallback(() => setModalCreditos(null), []);
    useFocusTrap(modalAtivarRef, !!modalAtivar, fecharModalAtivar);
    useFocusTrap(modalCreditosRef, !!modalCreditos, fecharModalCreditos);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/eu/api/usuarios?limit=50');
                const data = await res.json();
                setTodos(data.usuarios || []);
                setNextCursor(data.nextCursor || null);
            } catch (_) {
                mostrarToast('Falha ao carregar usuários.', true);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(t);
    }, [toast]);

    function mostrarToast(msg: string, erro: boolean): void {
        setToast({ msg, erro });
    }

    const lista = useMemo(() => {
        const q = busca.toLowerCase();
        return todos.filter(u => {
            const matchBusca = !q || u.email.toLowerCase().includes(q) || u.nome.toLowerCase().includes(q);
            const matchPlano = !filtroPlano || (filtroPlano === 'premium' && u.is_active) || (filtroPlano === 'free' && !u.is_active);
            return matchBusca && matchPlano;
        });
    }, [todos, busca, filtroPlano]);

    async function carregarMais(): Promise<void> {
        if (!nextCursor) return;
        setLoadingMore(true);
        try {
            const res = await fetch(`/eu/api/usuarios?cursor=${encodeURIComponent(nextCursor)}&limit=50`);
            const data = await res.json();
            if (!res.ok || data.erro) throw new Error(data.erro || 'Erro desconhecido');
            setTodos(prev => [...prev, ...(data.usuarios || [])]);
            setNextCursor(data.nextCursor || null);
        } catch (err) {
            mostrarToast(err instanceof Error ? err.message : 'Erro desconhecido', true);
        } finally {
            setLoadingMore(false);
        }
    }

    function abrirAtivacao(email: string): void {
        setModalAtivar({ email });
        setPlanoEscolhido('pro');
    }

    async function confirmarAtivacao(): Promise<void> {
        if (!modalAtivar) return;
        const email = modalAtivar.email;
        const plano = planoEscolhido;
        setModalAtivar(null);
        setAtivando(true);
        try {
            const res = await fetch(`/eu/api/usuario/${encodeURIComponent(email)}/premium`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ativo: true, plano }),
            });
            const data = await res.json();
            if (!res.ok || data.erro) throw new Error(data.erro || 'Erro desconhecido');
            setTodos(prev => prev.map(u => u.email === email ? { ...u, is_active: true, plano: data.plano } : u));
            mostrarToast(`${email} → Plano ${data.plano} ativado com créditos alocados`, false);
        } catch (err) {
            mostrarToast(err instanceof Error ? err.message : 'Erro desconhecido', true);
        } finally {
            setAtivando(false);
        }
    }

    async function revogarPremium(email: string): Promise<void> {
        if (!confirm(`Revogar acesso premium de ${email}?`)) return;
        setRevogandoEmail(email);
        try {
            const res = await fetch(`/eu/api/usuario/${encodeURIComponent(email)}/premium`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ativo: false }),
            });
            const data = await res.json();
            if (!res.ok || data.erro) throw new Error(data.erro || 'Erro desconhecido');
            setTodos(prev => prev.map(u => u.email === email ? { ...u, is_active: false, plano: 'free' } : u));
            mostrarToast(`${email} → Plano revogado`, false);
        } catch (err) {
            mostrarToast(err instanceof Error ? err.message : 'Erro desconhecido', true);
        } finally {
            setRevogandoEmail(null);
        }
    }

    function abrirCreditos(u: AdminAccount): void {
        setModalCreditos({ email: u.email });
        setInputGemini(String(u.creditos ?? 0));
    }

    async function confirmarCreditos(): Promise<void> {
        if (!modalCreditos) return;
        const email = modalCreditos.email;
        const gemini = inputGemini.trim();
        if (gemini === '') {
            mostrarToast('Informe ao menos um valor de crédito.', true);
            return;
        }
        setModalCreditos(null);
        setSalvandoCreditos(true);
        try {
            const body: { gemini?: number } = {};
            if (gemini !== '') body.gemini = parseInt(gemini, 10);
            const res = await fetch(`/eu/api/usuario/${encodeURIComponent(email)}/creditos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || data.erro) throw new Error(data.erro || 'Erro desconhecido');
            setTodos(prev => prev.map(u => {
                if (u.email !== email) return u;
                const next = { ...u };
                if (data.creditos != null) next.creditos = data.creditos;
                return next;
            }));
            let msg = `${email} → `;
            if (data.creditos != null) msg += `Gemini=${data.creditos} `;
            mostrarToast(msg.trim(), false);
        } catch (err) {
            mostrarToast(err instanceof Error ? err.message : 'Erro desconhecido', true);
        } finally {
            setSalvandoCreditos(false);
        }
    }

    return (
        <>
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-4 mt-2">
                <div>
                    <h1 className="fw-bolder text-white text-uppercase mb-1" style={{ fontSize: '1.5rem', letterSpacing: '-0.02em' }}>Gestão de Usuários</h1>
                    <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>{lista.length} usuários exibidos</p>
                </div>
            </div>

            {/* Busca e filtros */}
            <div className="d-flex align-items-center gap-3 flex-wrap mb-3" style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid var(--sl-bg-800)', borderRadius: '1rem', padding: '1rem' }}>
                <div className="position-relative flex-grow-1" style={{ minWidth: '192px' }}>
                    <Search size={14} className="position-absolute" style={{ left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--sl-text-500)' }} />
                    <input
                        type="text"
                        placeholder="Buscar por e-mail ou nome..."
                        className="form-control ps-4"
                        style={{ background: 'var(--sl-bg-800)', borderColor: 'var(--sl-bg-800)', color: 'var(--sl-text-300)' }}
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                    />
                </div>
                <div className="d-flex gap-2">
                    {[{ v: '', label: 'Todos' }, { v: 'premium', label: 'Premium' }, { v: 'free', label: 'Free' }].map(f => (
                        <button
                            key={f.v}
                            onClick={() => setFiltroPlano(f.v)}
                            className="btn btn-sm fw-bold text-uppercase"
                            style={{
                                fontSize: '11px', letterSpacing: '0.08em', borderRadius: '6px', minHeight: '44px', padding: '8px 14px',
                                background: filtroPlano === f.v ? (f.v === 'premium' ? 'rgba(34,197,94,0.15)' : 'var(--sl-bg-800)') : 'var(--sl-bg-950)',
                                color: filtroPlano === f.v ? (f.v === 'premium' ? '#4ade80' : '#fff') : 'var(--sl-text-500)',
                                border: `1px solid ${filtroPlano === f.v && f.v === 'premium' ? 'rgba(34,197,94,0.35)' : 'var(--sl-bg-800)'}`,
                            }}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {toast && (
                <div role={toast.erro ? 'alert' : 'status'} aria-live={toast.erro ? 'assertive' : 'polite'} className="mb-3" style={{ padding: '0.75rem 1rem', borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600, ...(toast.erro ? { background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' } : { background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }) }}>
                    {toast.msg}
                </div>
            )}

            {/* Tabela */}
            <div className="section-card overflow-hidden">
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--sl-bg-800)' }}>
                    <p className="section-label mb-0">Lista de Usuários</p>
                </div>
                <div className="table-responsive">
                    <table className="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--sl-text-500)', padding: '0.75rem 1rem', borderBottom: '1px solid var(--sl-bg-800)' }}>Usuário</th>
                                <th className="d-none d-md-table-cell" style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--sl-text-500)', padding: '0.75rem 1rem', borderBottom: '1px solid var(--sl-bg-800)' }}>Storage</th>
                                <th className="d-none d-lg-table-cell" style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--sl-text-500)', padding: '0.75rem 1rem', borderBottom: '1px solid var(--sl-bg-800)' }}>Créditos</th>
                                <th className="d-none d-lg-table-cell" style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--sl-text-500)', padding: '0.75rem 1rem', borderBottom: '1px solid var(--sl-bg-800)' }}>Criado em</th>
                                <th style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--sl-text-500)', padding: '0.75rem 1rem', borderBottom: '1px solid var(--sl-bg-800)' }}>Status / Plano</th>
                                <th className="text-end" style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--sl-text-500)', padding: '0.75rem 1rem', borderBottom: '1px solid var(--sl-bg-800)' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lista.map(u => {
                                const initChar = (u.nome || u.email).charAt(0).toUpperCase();
                                const planoLabel = (u.plano || 'free').charAt(0).toUpperCase() + (u.plano || 'free').slice(1);
                                return (
                                    <tr key={u.email} style={{ borderColor: 'rgba(30,41,59,0.6)' }}>
                                        <td style={{ padding: '0.65rem 1rem', verticalAlign: 'middle' }}>
                                            <div className="d-flex align-items-center gap-2">
                                                <div className="d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--sl-bg-800)', color: 'var(--sl-text-400)', fontSize: '12px', fontWeight: 900 }}>{initChar}</div>
                                                <div className="overflow-hidden">
                                                    <p className="fw-semibold text-white mb-0 text-truncate small">{u.email}</p>
                                                    <p className="mb-0" style={{ fontSize: '10px', color: 'var(--sl-text-500)' }}>{u.nome}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="d-none d-md-table-cell" style={{ padding: '0.65rem 1rem', verticalAlign: 'middle' }}>
                                            <span className="small font-monospace" style={{ color: 'var(--sl-text-400)' }}>{u.storage_usado_mb} MB</span>
                                        </td>
                                        <td className="d-none d-lg-table-cell" style={{ padding: '0.65rem 1rem', verticalAlign: 'middle' }}>
                                            <div style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--sl-text-500)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                <span>Gem: {u.creditos ?? 0}</span>
                                            </div>
                                        </td>
                                        <td className="d-none d-lg-table-cell" style={{ padding: '0.65rem 1rem', verticalAlign: 'middle' }}>
                                            <span style={{ fontSize: '11px', color: 'var(--sl-text-500)' }}>{u.criado_em}</span>
                                        </td>
                                        <td style={{ padding: '0.65rem 1rem', verticalAlign: 'middle' }}>
                                            <div className="d-flex align-items-center gap-1 flex-wrap">
                                                <span className={`status-badge ${u.is_active ? 'status-premium' : 'status-free'}`}>{u.is_active ? 'Premium' : 'Free'}</span>
                                                <span className={`plan-badge ${planoBadgeClass(u.plano)}`}>{planoLabel}</span>
                                            </div>
                                        </td>
                                        <td className="text-end" style={{ padding: '0.65rem 1rem', verticalAlign: 'middle' }}>
                                            <div className="d-inline-flex align-items-center gap-1">
                                                {u.is_active ? (
                                                    <button
                                                        onClick={() => revogarPremium(u.email)}
                                                        disabled={revogandoEmail === u.email}
                                                        className="btn btn-sm fw-bold text-uppercase"
                                                        style={{ fontSize: '11px', letterSpacing: '0.06em', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                                                    >
                                                        {revogandoEmail === u.email ? <span className="spinner-border spinner-border-sm" role="status"></span> : 'Revogar'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => abrirAtivacao(u.email)}
                                                        className="btn btn-sm fw-bold text-uppercase"
                                                        style={{ fontSize: '11px', letterSpacing: '0.06em', background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}
                                                    >
                                                        Ativar
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => abrirCreditos(u)}
                                                    className="btn btn-sm fw-bold text-uppercase d-inline-flex align-items-center justify-content-center"
                                                    title="Gerenciar créditos"
                                                    style={{ fontSize: '11px', letterSpacing: '0.06em', background: 'rgba(250,204,21,0.1)', color: '#fbbf24', border: '1px solid rgba(250,204,21,0.3)', minWidth: '44px' }}
                                                >
                                                    <Coins size={13} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {!loading && lista.length === 0 && (
                        <div className="px-4 py-5 text-center">
                            <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>Nenhum usuário encontrado.</p>
                        </div>
                    )}
                    {loading && (
                        <div className="px-4 py-5 text-center">
                            <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
                        </div>
                    )}
                </div>
                {nextCursor && (
                    <div className="px-4 py-3 text-center" style={{ borderTop: '1px solid var(--sl-bg-800)' }}>
                        <button onClick={carregarMais} disabled={loadingMore} className="btn btn-sm fw-bold text-uppercase d-inline-flex align-items-center gap-1"
                                style={{ background: 'var(--sl-bg-800)', color: 'var(--sl-text-300)', border: '1px solid var(--sl-bg-700)', letterSpacing: '0.08em', fontSize: '11px' }}>
                            {loadingMore ? <span className="spinner-border spinner-border-sm" role="status"></span> : <ArrowDownCircle size={14} />}
                            Carregar mais
                        </button>
                    </div>
                )}
            </div>

            {/* Modal: Ativar */}
            {modalAtivar && (
                <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-3"
                     style={{ background: 'rgba(0,0,0,.6)', zIndex: 1050 }}
                     onClick={e => { if (e.target === e.currentTarget) setModalAtivar(null); }}>
                    <div
                        ref={modalAtivarRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="modal-ativar-titulo"
                        className="sl-card mb-0"
                        style={{ maxWidth: '420px', width: '100%', background: '#0f172a', border: '1px solid var(--sl-bg-800)' }}
                    >
                        <div className="d-flex align-items-start justify-content-between mb-3">
                            <h2 id="modal-ativar-titulo" className="fw-bold text-uppercase mb-0" style={{ fontSize: '0.85rem', letterSpacing: '0.08em' }}>Ativar Plano</h2>
                            <button type="button" aria-label="Fechar" className="btn-close btn-close-white" onClick={() => setModalAtivar(null)}></button>
                        </div>
                        <p className="small mb-3" style={{ color: 'var(--sl-text-400)' }}>
                            Usuário: <strong className="text-white">{modalAtivar.email}</strong>
                        </p>
                        <label htmlFor="modal-ativar-select" className="form-label fw-bold text-uppercase" style={{ fontSize: '10px', letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>Plano a ativar</label>
                        <select id="modal-ativar-select" className="form-select mb-3" value={planoEscolhido} onChange={e => setPlanoEscolhido(e.target.value as PremiumPlan)}
                                style={{ background: 'var(--sl-bg-800)', borderColor: 'var(--sl-bg-700)', color: 'var(--sl-text-300)' }}>
                            <option value="starter">Starter — 500 créditos Gemini</option>
                            <option value="pro">Pro — 2.000 créditos Gemini</option>
                            <option value="studio">Studio — 5.500 créditos Gemini</option>
                        </select>
                        <div className="d-flex align-items-start gap-2" style={{ background: 'rgba(30,41,59,0.6)', border: '1px solid var(--sl-bg-700)', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: 'var(--sl-text-400)' }}>
                            <Info size={14} className="flex-shrink-0 mt-1" />
                            <span>
                                {PLANO_INFO[planoEscolhido].label}: {PLANO_INFO[planoEscolhido].gemini} créditos Gemini
                                — validade 30 dias.
                            </span>
                        </div>
                        <div className="d-flex justify-content-end gap-2 mt-4">
                            <button type="button" className="btn btn-sm fw-bold text-uppercase" onClick={() => setModalAtivar(null)}
                                    style={{ background: 'var(--sl-bg-800)', color: 'var(--sl-text-400)', border: '1px solid var(--sl-bg-700)', letterSpacing: '0.08em', fontSize: '11px' }}>
                                Cancelar
                            </button>
                            <button type="button" onClick={confirmarAtivacao} disabled={ativando} className="btn btn-sm fw-bold text-uppercase"
                                    style={{ letterSpacing: '0.08em', fontSize: '11px', background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
                                Ativar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Créditos */}
            {modalCreditos && (
                <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-3"
                     style={{ background: 'rgba(0,0,0,.6)', zIndex: 1050 }}
                     onClick={e => { if (e.target === e.currentTarget) setModalCreditos(null); }}>
                    <div
                        ref={modalCreditosRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="modal-creditos-titulo"
                        className="sl-card mb-0"
                        style={{ maxWidth: '420px', width: '100%', background: '#0f172a', border: '1px solid var(--sl-bg-800)' }}
                    >
                        <div className="d-flex align-items-start justify-content-between mb-3">
                            <h2 id="modal-creditos-titulo" className="fw-bold text-uppercase mb-0" style={{ fontSize: '0.85rem', letterSpacing: '0.08em' }}>Gerenciar Créditos</h2>
                            <button type="button" aria-label="Fechar" className="btn-close btn-close-white" onClick={() => setModalCreditos(null)}></button>
                        </div>
                        <p className="small mb-3" style={{ color: 'var(--sl-text-400)' }}>
                            Usuário: <strong className="text-white">{modalCreditos.email}</strong>
                        </p>
                        <div className="row g-3">
                            <div className="col-6">
                                <label htmlFor="modal-creditos-gemini" className="form-label fw-bold text-uppercase" style={{ fontSize: '10px', letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>Gemini</label>
                                <input id="modal-creditos-gemini" type="number" className="form-control" min="0" max="99999" placeholder="ex: 2000"
                                       value={inputGemini} onChange={e => setInputGemini(e.target.value)}
                                       style={{ background: 'var(--sl-bg-800)', borderColor: 'var(--sl-bg-700)', color: 'var(--sl-text-300)' }} />
                            </div>
                        </div>
                        <div className="mt-3" style={{ background: 'rgba(30,41,59,0.6)', border: '1px solid var(--sl-bg-700)', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: 'var(--sl-text-400)' }}>
                            <Info size={14} className="me-1" />
                            Define o valor absoluto de créditos. Validade renovada para 30 dias. Deixe em branco para não alterar.
                        </div>
                        <div className="d-flex justify-content-end gap-2 mt-4">
                            <button type="button" className="btn btn-sm fw-bold text-uppercase" onClick={() => setModalCreditos(null)}
                                    style={{ background: 'var(--sl-bg-800)', color: 'var(--sl-text-400)', border: '1px solid var(--sl-bg-700)', letterSpacing: '0.08em', fontSize: '11px' }}>
                                Cancelar
                            </button>
                            <button type="button" onClick={confirmarCreditos} disabled={salvandoCreditos} className="btn btn-sm fw-bold text-uppercase d-flex align-items-center gap-1"
                                    style={{ letterSpacing: '0.08em', fontSize: '11px', background: 'rgba(250,204,21,0.1)', color: '#fbbf24', border: '1px solid rgba(250,204,21,0.3)' }}>
                                <Coins size={13} /> Salvar Créditos
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
