import React, { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { FolderOpen, Plus, Trash2, Cpu, Download, FileCode, AlertCircle, RefreshCw, History, RotateCcw, X, MessageSquare } from 'lucide-react';
import Pill from '../components/Pill';

export default function Workspace() {
    const { user } = useOutletContext();
    const [projetos, setProjetos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [novoNome, setNovoNome] = useState('');
    const [criando, setCriando] = useState(false);
    const [erro, setErro] = useState('');
    const [selectedProjeto, setSelectedProjeto] = useState(null);

    // Nova sessão
    const [criandoSessao, setCriandoSessao] = useState(false);
    const [nomeSessao, setNomeSessao] = useState('');
    const [mostrarFormSessao, setMostrarFormSessao] = useState(false);

    // Histórico de versões da sessão aberta
    const [sessaoHistorico, setSessaoHistorico] = useState(null); // { sessaoId, versoes, carregando }
    const [revertendoId, setRevertendoId] = useState(null);

    const carregarProjetos = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/workspace/projetos');
            const data = await res.json();
            if (res.ok) {
                setProjetos(data.projetos || []);
                if (data.projetos?.length > 0) {
                    setSelectedProjeto(prev => {
                        if (!prev) return data.projetos[0];
                        // Mantém a seleção, mas com os dados atualizados
                        return data.projetos.find(p => p.id === prev.id) || data.projetos[0];
                    });
                }
            } else {
                setErro(data.erro || 'Falha ao carregar projetos.');
            }
        } catch (e) {
            setErro('Erro de conexão com o servidor.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        carregarProjetos();
    }, []);

    const criarProjeto = async (e) => {
        e.preventDefault();
        if (!novoNome.trim()) return;
        setCriando(true);
        setErro('');
        try {
            const res = await fetch('/api/workspace/projetos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: novoNome })
            });
            const data = await res.json();
            if (res.ok) {
                setNovoNome('');
                await carregarProjetos();
            } else {
                setErro(data.erro || 'Erro ao criar projeto.');
            }
        } catch (err) {
            setErro('Erro de conexão.');
        } finally {
            setCriando(false);
        }
    };

    const deletarProjeto = async (id) => {
        if (!window.confirm('Tem certeza que deseja excluir este projeto e todas as suas sessões?')) return;
        try {
            const res = await fetch(`/api/workspace/projetos/${id}`, { method: 'DELETE' });
            if (res.ok) {
                if (selectedProjeto?.id === id) {
                    setSelectedProjeto(null);
                }
                await carregarProjetos();
            } else {
                const data = await res.json();
                alert(data.erro || 'Erro ao deletar projeto.');
            }
        } catch (err) {
            alert('Erro de conexão.');
        }
    };

    const criarSessao = async (e) => {
        e.preventDefault();
        if (!selectedProjeto || !nomeSessao.trim()) return;
        setCriandoSessao(true);
        setErro('');
        try {
            const res = await fetch(`/api/workspace/projetos/${selectedProjeto.id}/sessoes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: nomeSessao }),
            });
            const data = await res.json();
            if (res.ok) {
                setNomeSessao('');
                setMostrarFormSessao(false);
                await carregarProjetos();
            } else {
                setErro(data.erro || 'Erro ao criar sessão.');
            }
        } catch (err) {
            setErro('Erro de conexão.');
        } finally {
            setCriandoSessao(false);
        }
    };

    const deletarSessao = async (sid) => {
        if (!selectedProjeto || !window.confirm('Excluir esta sessão?')) return;
        try {
            const res = await fetch(`/api/workspace/projetos/${selectedProjeto.id}/sessoes/${sid}`, { method: 'DELETE' });
            if (res.ok) {
                if (sessaoHistorico?.sessaoId === sid) setSessaoHistorico(null);
                await carregarProjetos();
            } else {
                const data = await res.json();
                alert(data.erro || 'Erro ao deletar sessão.');
            }
        } catch (err) {
            alert('Erro de conexão.');
        }
    };

    const abrirHistorico = async (sid) => {
        if (sessaoHistorico?.sessaoId === sid) {
            setSessaoHistorico(null); // clique de novo = fecha
            return;
        }
        setSessaoHistorico({ sessaoId: sid, versoes: [], carregando: true });
        try {
            const res = await fetch(`/api/workspace/projetos/${selectedProjeto.id}/sessoes/${sid}/historico`);
            const versoes = await res.json();
            setSessaoHistorico({ sessaoId: sid, versoes: res.ok ? versoes : [], carregando: false });
        } catch (err) {
            setSessaoHistorico({ sessaoId: sid, versoes: [], carregando: false });
        }
    };

    const reverterVersao = async (sid, compilacaoId) => {
        if (!window.confirm('Reverter a sessão para esta versão? Isso vira uma nova entrada no histórico — nada é apagado.')) return;
        setRevertendoId(compilacaoId);
        try {
            const res = await fetch(`/api/workspace/projetos/${selectedProjeto.id}/sessoes/${sid}/reverter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ compilacaoId }),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.erro || 'Erro ao reverter.');
                return;
            }
            setSessaoHistorico(null);
            await carregarProjetos();
        } catch (err) {
            alert('Erro de conexão ao reverter.');
        } finally {
            setRevertendoId(null);
        }
    };

    return (
        <div className="p-3 p-md-5">
            {/* Header */}
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3 mb-5">
                <div>
                    <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                        Workspace Industrial
                    </h1>
                    <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Gerencie projetos, versões e sessões de engenharia em tempo real.</p>
                </div>
                <div className="d-flex align-items-center gap-2">
                    <button onClick={carregarProjetos} className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1">
                        <RefreshCw size={14} className={loading ? 'fa-spin' : ''} /> Atualizar
                    </button>
                    <Link to="/dashboard/workspace/chat" className="btn btn-sl-primary btn-sm d-flex align-items-center gap-1">
                        <Plus size={16} /> Novo Projeto IA
                    </Link>
                </div>
            </div>

            {erro && (
                <div className="alert alert-danger d-flex align-items-center gap-2 mb-4" role="alert">
                    <AlertCircle size={18} />
                    <span>{erro}</span>
                </div>
            )}

            {/* Criar Projeto Rápido */}
            <div className="sl-card mb-4">
                <form onSubmit={criarProjeto} className="row g-3 align-items-center">
                    <div className="col-12 col-md-8">
                        <input
                            type="text"
                            className="form-control bg-dark text-light border-secondary"
                            placeholder="Nome do novo projeto (ex: Blog Profissional v2)"
                            value={novoNome}
                            onChange={(e) => setNovoNome(e.target.value)}
                            maxLength={60}
                            required
                        />
                    </div>
                    <div className="col-12 col-md-4">
                        <button type="submit" className="btn btn-sl-primary w-100 fw-bold" disabled={criando}>
                            {criando ? 'Criando...' : 'Criar Projeto Vazio'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Lista de Projetos */}
            {loading && projetos.length === 0 ? (
                <div className="text-center py-5">
                    <div className="spinner-border text-primary" role="status"></div>
                    <p className="text-secondary small mt-2">Carregando workspace...</p>
                </div>
            ) : projetos.length === 0 ? (
                <div className="sl-card text-center py-5">
                    <FolderOpen size={48} className="text-muted mb-3" />
                    <h2 className="fw-bold mb-2 fs-3">Nenhum projeto encontrado</h2>
                    <p className="text-secondary small mb-4">Crie seu primeiro projeto acima ou inicie uma conversa com a IA para gerar um template Blogger completo.</p>
                    <Link to="/dashboard/workspace/chat" className="btn btn-sl-primary btn-sm">Iniciar Chat IA</Link>
                </div>
            ) : (
                <div className="row g-4">
                    {/* Seletor Lateral de Projetos */}
                    <div className="col-12 col-lg-4">
                        <div className="sl-card p-0 overflow-hidden mb-0">
                            <div className="p-3 border-bottom border-secondary bg-dark">
                                <h2 className="fw-black text-uppercase mb-0 small" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                                    Projetos Salvos ({projetos.length})
                                </h2>
                            </div>
                            <div className="list-group list-group-flush" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                {projetos.map(proj => {
                                    const isSelected = selectedProjeto?.id === proj.id;
                                    return (
                                        <div
                                            key={proj.id}
                                            onClick={() => { setSelectedProjeto(proj); setSessaoHistorico(null); setMostrarFormSessao(false); }}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedProjeto(proj); setSessaoHistorico(null); setMostrarFormSessao(false); } }}
                                            aria-pressed={isSelected}
                                            className={`list-group-item list-group-item-action bg-transparent text-light border-secondary p-3 ${isSelected ? 'active-project' : ''}`}
                                            style={{ cursor: 'pointer', background: isSelected ? 'rgba(14,165,233,0.1)' : 'transparent' }}
                                        >
                                            <div className="d-flex align-items-center justify-content-between mb-1">
                                                <h3 className="fw-bold mb-0 text-truncate fs-6">{proj.nome}</h3>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deletarProjeto(proj.id); }}
                                                    className="btn btn-link text-danger p-0"
                                                    title="Excluir projeto"
                                                    aria-label="Excluir projeto"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                            <div className="d-flex align-items-center justify-content-between small text-secondary">
                                                <span>{proj.sessoes?.length || 0} sessões IA</span>
                                                <span>{proj.criadoEmFmt}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Detalhes do Projeto Selecionado */}
                    <div className="col-12 col-lg-8">
                        {selectedProjeto ? (
                            <div className="sl-card mb-0">
                                <div className="d-flex align-items-center justify-content-between mb-4 pb-3 border-bottom border-secondary flex-wrap gap-2">
                                    <div>
                                        <h2 className="fw-bold mb-1 fs-3">{selectedProjeto.nome}</h2>
                                        <p className="small mb-0 text-secondary">Criado em {selectedProjeto.criadoEmFmt}</p>
                                    </div>
                                    <div className="d-flex align-items-center gap-2">
                                        <button
                                            onClick={() => setMostrarFormSessao(v => !v)}
                                            className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1"
                                        >
                                            <Plus size={14} /> Nova Sessão
                                        </button>
                                        {selectedProjeto.sessoes?.length > 0 && (
                                            <a
                                                href={`/dashboard/workspace/chat?wsSession=${selectedProjeto.sessoes[0].id}&projeto=${selectedProjeto.id}`}
                                                className="btn btn-sl-primary btn-sm d-flex align-items-center gap-1"
                                            >
                                                <MessageSquare size={14} /> Continuar Chat IA
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {mostrarFormSessao && (
                                    <form onSubmit={criarSessao} className="d-flex gap-2 mb-4">
                                        <input
                                            type="text"
                                            className="form-control form-control-sm bg-dark text-light border-secondary"
                                            placeholder="Nome da sessão (ex: Ajustes de SEO)"
                                            value={nomeSessao}
                                            onChange={(e) => setNomeSessao(e.target.value)}
                                            maxLength={80}
                                            autoFocus
                                            required
                                        />
                                        <button type="submit" className="btn btn-sl-primary btn-sm flex-shrink-0" disabled={criandoSessao}>
                                            {criandoSessao ? 'Criando...' : 'Criar'}
                                        </button>
                                        <button type="button" className="btn btn-outline-secondary btn-sm flex-shrink-0" onClick={() => setMostrarFormSessao(false)}>
                                            <X size={14} />
                                        </button>
                                    </form>
                                )}

                                <h3 className="fw-bold mb-3 small text-uppercase" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                                    Histórico de Sessões e Versões ({selectedProjeto.sessoes?.length || 0})
                                </h3>

                                {selectedProjeto.sessoes?.length === 0 ? (
                                    <p className="text-secondary small">Nenhuma sessão registrada neste projeto ainda. Crie uma acima para vincular a última compilação gerada.</p>
                                ) : (
                                    <div className="d-flex flex-column gap-3">
                                        {selectedProjeto.sessoes.map(sessao => {
                                            const compilacaoId = sessao.snapshot?.compilacaoId;
                                            const historicoAberto = sessaoHistorico?.sessaoId === sessao.id;
                                            return (
                                                <div key={sessao.id} className="p-3 rounded border border-secondary bg-dark">
                                                    <div className="d-flex align-items-center justify-content-between mb-2">
                                                        <div className="d-flex align-items-center gap-2 min-width-0">
                                                            <FileCode size={18} className="text-info flex-shrink-0" />
                                                            <span className="fw-bold small text-truncate">{sessao.nome || `Sessão #${sessao.id.substring(0, 8)}`}</span>
                                                        </div>
                                                        <span className="small text-secondary flex-shrink-0 ms-2">{sessao.criadoEmFmt}</span>
                                                    </div>
                                                    {sessao.snapshot?.siteName && (
                                                        <p className="small mb-3 text-secondary text-truncate">
                                                            <Cpu size={12} className="me-1" style={{ marginTop: '-2px' }} />
                                                            Vinculada a "{sessao.snapshot.siteName}"
                                                        </p>
                                                    )}
                                                    <div className="d-flex align-items-center gap-2 flex-wrap">
                                                        {compilacaoId && (
                                                            <a href={`/dashboard/compilacao/${compilacaoId}/download`} className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1">
                                                                <Download size={14} /> Baixar XML
                                                            </a>
                                                        )}
                                                        <a
                                                            href={`/dashboard/workspace/chat?wsSession=${sessao.id}&projeto=${selectedProjeto.id}`}
                                                            className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1"
                                                        >
                                                            <MessageSquare size={14} /> Chat IA
                                                        </a>
                                                        <button
                                                            onClick={() => abrirHistorico(sessao.id)}
                                                            className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1"
                                                        >
                                                            <History size={14} /> {historicoAberto ? 'Fechar Histórico' : 'Ver Histórico / Diff'}
                                                        </button>
                                                        <button
                                                            onClick={() => deletarSessao(sessao.id)}
                                                            className="btn btn-outline-danger btn-sm d-flex align-items-center gap-1 ms-auto"
                                                            title="Excluir sessão"
                                                            aria-label="Excluir sessão"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>

                                                    {historicoAberto && (
                                                        <div className="mt-3 pt-3 border-top border-secondary">
                                                            {sessaoHistorico.carregando ? (
                                                                <div className="text-center py-3">
                                                                    <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
                                                                </div>
                                                            ) : sessaoHistorico.versoes.length === 0 ? (
                                                                <p className="small text-secondary mb-0">Nenhuma versão registrada para esta sessão.</p>
                                                            ) : (
                                                                <div className="d-flex flex-column gap-2">
                                                                    {sessaoHistorico.versoes.map(v => (
                                                                        <div key={v.id} className="d-flex align-items-center justify-content-between gap-2 p-2 rounded" style={{ background: 'rgba(255,255,255,.03)' }}>
                                                                            <div className="min-width-0">
                                                                                <div className="d-flex align-items-center gap-2">
                                                                                    <Pill tone="primary" pill={false} uppercase={false} size="sm">{v.origemLabel}</Pill>
                                                                                    <span className="small text-secondary">{v.criadoEmFmt}</span>
                                                                                </div>
                                                                                {v.resumoMudancas && (
                                                                                    <p className="small mb-0 mt-1 text-truncate" style={{ maxWidth: '360px' }}>{v.resumoMudancas}</p>
                                                                                )}
                                                                            </div>
                                                                            <button
                                                                                onClick={() => reverterVersao(sessao.id, v.id)}
                                                                                disabled={revertendoId === v.id}
                                                                                className="btn btn-outline-warning btn-sm d-flex align-items-center gap-1 flex-shrink-0"
                                                                                title="Reverter para esta versão"
                                                                                aria-label="Reverter para esta versão"
                                                                            >
                                                                                {revertendoId === v.id
                                                                                    ? <span className="spinner-border spinner-border-sm" role="status"></span>
                                                                                    : <RotateCcw size={13} />}
                                                                                <span className="d-none d-md-inline">Reverter</span>
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="sl-card text-center py-5">
                                <p className="text-secondary">Selecione um projeto na lista ao lado para ver os detalhes.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
