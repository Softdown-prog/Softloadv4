import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { History, Download, Cpu, HardDrive, FileCode, Eye, Trash2, RefreshCw, Search, FolderSymlink, Check } from 'lucide-react';

export default function Historico() {
    const { user } = useOutletContext();
    const [data, setData] = useState({ compilacoes: [], totalIA: 0, storageLimitMb: 5 });
    const [loading, setLoading] = useState(true);
    const [busca, setBusca] = useState('');
    const [excluindoId, setExcluindoId] = useState(null);
    const [erro, setErro] = useState('');
    const [importandoId, setImportandoId] = useState(null);
    const [importadosIds, setImportadosIds] = useState(() => new Set());

    const carregarHistorico = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/historico');
            const json = await res.json();
            if (res.ok) {
                setData(json);
            }
        } catch (e) {
            console.error('Erro ao carregar histórico:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        carregarHistorico();
    }, []);

    const compilacoesFiltradas = useMemo(() => {
        const termo = busca.toLowerCase().trim();
        if (!termo) return data.compilacoes;
        return data.compilacoes.filter(c => (c.siteName || '').toLowerCase().includes(termo));
    }, [data.compilacoes, busca]);

    const storageUsadoMb = user?.storage_usado_mb || 0;
    const storagePct = data.storageLimitMb > 0
        ? Math.min((storageUsadoMb / data.storageLimitMb) * 100, 100)
        : 0;

    async function excluirCompilacao(id) {
        if (!window.confirm('Excluir este template permanentemente? O arquivo ZIP e o XML serão removidos do armazenamento.')) return;

        setExcluindoId(id);
        setErro('');
        try {
            const res = await fetch(`/dashboard/compilacao/${id}`, {
                method: 'DELETE',
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.erro) {
                throw new Error(json.erro || `Erro ${res.status} ao excluir.`);
            }
            setData(prev => ({
                ...prev,
                compilacoes: prev.compilacoes.filter(c => c.id !== id),
            }));
        } catch (e) {
            setErro(e.message || 'Falha ao excluir. Tente novamente.');
        } finally {
            setExcluindoId(null);
        }
    }

    async function importarParaWorkspace(id) {
        setImportandoId(id);
        setErro('');
        try {
            const res = await fetch('/api/workspace/importar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ compilacaoId: id }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.erro) {
                throw new Error(json.erro || `Erro ${res.status} ao importar.`);
            }
            setImportadosIds(prev => new Set(prev).add(id));
        } catch (e) {
            setErro(e.message || 'Falha ao importar para o Workspace. Tente novamente.');
        } finally {
            setImportandoId(null);
        }
    }

    return (
        <div className="p-3 p-md-5">
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3 mb-5">
                <div>
                    <h1 className="fw-bolder text-uppercase mb-1" style={{ fontSize: '1.4rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                        Histórico de Compilações
                    </h1>
                    <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>Últimas gerações e templates XML blindados no motor Softload.</p>
                </div>
                <button onClick={carregarHistorico} className="btn btn-sl-outline btn-sm d-flex align-items-center gap-1">
                    <RefreshCw size={14} className={loading ? 'fa-spin' : ''} /> Atualizar Histórico
                </button>
            </div>

            {erro && (
                <div className="alert alert-danger py-2 px-3 small mb-4" role="alert">
                    {erro}
                </div>
            )}

            <div className="row g-3 mb-4">
                <div className="col-12 col-md-4">
                    <div className="sl-card mb-0 h-100">
                        <div className="d-flex align-items-center gap-3">
                            <div className="rounded p-2" style={{ background: 'rgba(14,165,233,.1)', color: 'var(--sl-primary)' }}>
                                <History size={20} />
                            </div>
                            <div>
                                <p className="small text-uppercase font-monospace mb-0" style={{ fontSize: '9px', color: 'var(--sl-text-400)' }}>Total no Histórico</p>
                                <p className="fw-bold mb-0 fs-4">{data.compilacoes.length} arquivos</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-12 col-md-4">
                    <div className="sl-card mb-0 h-100">
                        <div className="d-flex align-items-center gap-3">
                            <div className="rounded p-2" style={{ background: 'rgba(99,102,241,.1)', color: '#818cf8' }}>
                                <Cpu size={20} />
                            </div>
                            <div>
                                <p className="small text-uppercase font-monospace mb-0" style={{ fontSize: '9px', color: 'var(--sl-text-400)' }}>Gerados por IA</p>
                                <p className="fw-bold mb-0 fs-4">{data.totalIA} templates</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-12 col-md-4">
                    <div className="sl-card mb-0 h-100">
                        <div className="d-flex align-items-center gap-3 mb-2">
                            <div className="rounded p-2" style={{ background: 'rgba(34,197,94,.1)', color: '#22c55e' }}>
                                <HardDrive size={20} />
                            </div>
                            <div>
                                <p className="small text-uppercase font-monospace mb-0" style={{ fontSize: '9px', color: 'var(--sl-text-400)' }}>Armazenamento</p>
                                <p className="fw-bold mb-0 fs-4">{storageUsadoMb.toFixed(1)} <span className="small fw-normal text-secondary">/ {data.storageLimitMb} MB</span></p>
                            </div>
                        </div>
                        <div className="w-100 rounded-pill" style={{ height: '4px', background: 'rgba(148,163,184,.15)' }}>
                            <div className="rounded-pill" style={{ height: '4px', width: `${storagePct}%`, background: storagePct > 85 ? '#f87171' : 'var(--sl-primary)', transition: 'width .3s' }}></div>
                        </div>
                    </div>
                </div>
            </div>

            {!loading && data.compilacoes.length > 0 && (
                <div className="position-relative mb-3" style={{ maxWidth: '320px' }}>
                    <Search size={14} className="position-absolute" style={{ left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--sl-text-400)' }} />
                    <input
                        type="search"
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar por nome do site..."
                        className="form-control form-control-sm"
                        style={{ paddingLeft: '30px' }}
                    />
                </div>
            )}

            {loading ? (
                <div className="text-center py-5">
                    <div className="spinner-border text-primary" role="status"></div>
                    <p className="text-secondary small mt-2">Carregando histórico...</p>
                </div>
            ) : data.compilacoes.length === 0 ? (
                <div className="sl-card text-center py-5">
                    <History size={48} className="text-muted mb-3" />
                    <h2 className="fw-bold mb-2 fs-3">Nenhuma compilação encontrada</h2>
                    <p className="text-secondary small mb-4">Gere seu primeiro template XML no Solaris Code ou no compilador.</p>
                    <Link to="/dashboard/solaris" className="btn btn-sl-primary btn-sm">Abrir Solaris Code</Link>
                </div>
            ) : compilacoesFiltradas.length === 0 ? (
                <div className="sl-card text-center py-4">
                    <Search size={28} className="text-muted mb-2" />
                    <p className="small mb-0 text-secondary">Nenhuma compilação encontrada para "{busca}".</p>
                </div>
            ) : (
                <>
                    {/* Mobile-first: abaixo de xl (1200px), a tabela vira lista de
                        cards -- achado real (auditado com Chromium de verdade,
                        simulando a sidebar fixa de 260px que DashboardLayout.jsx
                        só mostra a partir de lg): a <table> de 5 colunas + 4
                        botões de ação tem ~1030px de largura própria, mas a área
                        de conteúdo real (viewport - sidebar) só chega a essa
                        largura por volta de 1350-1400px -- em qualquer breakpoint
                        padrão do Bootstrap abaixo disso (inclusive lg/992px, que
                        foi a 1ª tentativa aqui) a coluna de Ações ainda ficava
                        parcialmente fora da área visível. Em card, cada
                        compilação ocupa a largura cheia do conteúdo -- os mesmos
                        4 botões cabem com texto visível, sem depender da largura
                        de nenhuma outra coluna. */}
                    <div className="d-xl-none">
                        {compilacoesFiltradas.map(c => (
                            <div key={c.id} className="sl-card p-3 mb-3">
                                <div className="d-flex align-items-start gap-2 mb-3">
                                    <FileCode size={18} className="text-info flex-shrink-0 mt-1" />
                                    <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                        <span className="fw-bold d-block text-truncate">{c.siteName}</span>
                                        <span className="font-monospace text-secondary" style={{ fontSize: '11px' }}>{c.arquivo}</span>
                                    </div>
                                </div>
                                <div className="d-flex flex-wrap align-items-center gap-3 mb-3 small" style={{ color: 'var(--sl-text-400)' }}>
                                    <span className="d-flex align-items-center gap-1">
                                        <span className="rounded-circle" style={{ width: '8px', height: '8px', background: c.colorHex || '#0ea5e9' }}></span>
                                        {c.colorLabel}
                                    </span>
                                    <span className="font-monospace">{Math.round((c.tamanhoBytes || 0) / 1024)} KB</span>
                                    <span>{c.criadoEm}</span>
                                </div>
                                <div className="d-flex flex-wrap gap-2">
                                    {c.xmlPath && (
                                        <a
                                            href={`/dashboard/preview/${c.id}`}
                                            className="btn btn-outline-info btn-sm d-flex align-items-center justify-content-center gap-1 flex-grow-1"
                                            aria-label="Pré-visualizar"
                                            style={{ minHeight: '44px', flexBasis: 'calc(50% - 4px)' }}
                                        >
                                            <Eye size={14} /> Preview
                                        </a>
                                    )}
                                    <a
                                        href={`/dashboard/compilacao/${c.id}/download`}
                                        aria-label="Baixar"
                                        className="btn btn-outline-secondary btn-sm d-flex align-items-center justify-content-center gap-1 flex-grow-1"
                                        style={{ minHeight: '44px', flexBasis: 'calc(50% - 4px)' }}
                                    >
                                        <Download size={14} /> Baixar
                                    </a>
                                    <button
                                        onClick={() => importarParaWorkspace(c.id)}
                                        disabled={importandoId === c.id || importadosIds.has(c.id)}
                                        className="btn btn-outline-secondary btn-sm d-flex align-items-center justify-content-center gap-1 flex-grow-1"
                                        aria-label={importadosIds.has(c.id) ? 'Importado para o Workspace' : 'Importar para o Workspace'}
                                        style={{ minHeight: '44px', flexBasis: 'calc(50% - 4px)' }}
                                    >
                                        {importandoId === c.id
                                            ? <span className="spinner-border spinner-border-sm" role="status"></span>
                                            : importadosIds.has(c.id)
                                                ? <Check size={14} className="text-success" />
                                                : <FolderSymlink size={14} />}
                                        {importadosIds.has(c.id) ? 'Importado' : 'Workspace'}
                                    </button>
                                    <button
                                        onClick={() => excluirCompilacao(c.id)}
                                        disabled={excluindoId === c.id}
                                        className="btn btn-outline-danger btn-sm d-flex align-items-center justify-content-center gap-1 flex-grow-1"
                                        aria-label="Excluir template"
                                        style={{ minHeight: '44px', flexBasis: 'calc(50% - 4px)' }}
                                    >
                                        {excluindoId === c.id
                                            ? <span className="spinner-border spinner-border-sm" role="status"></span>
                                            : <><Trash2 size={14} /> Excluir</>}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* xl e acima (>=1200px): tabela original, inalterada -- é o
                        primeiro breakpoint padrão do Bootstrap onde a área de
                        conteúdo real (descontando a sidebar) chega perto da
                        largura própria da tabela (~1030px); abaixo disso a
                        coluna de Ações ficava cortada mesmo com
                        .table-responsive. */}
                    <div className="sl-card p-0 overflow-hidden mb-0 d-none d-xl-block">
                        <div className="table-responsive">
                            <table className="table table-dark table-hover mb-0 align-middle">
                                <thead>
                                    <tr style={{ fontSize: '11px', letterSpacing: '0.05em', color: 'var(--sl-text-400)', background: 'rgba(255,255,255,0.02)' }}>
                                        <th className="py-3 px-4">Template / Site</th>
                                        <th className="py-3 px-3">Paleta / Estilo</th>
                                        <th className="py-3 px-3">Tamanho</th>
                                        <th className="py-3 px-3">Data</th>
                                        <th className="py-3 px-4 text-end">Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {compilacoesFiltradas.map(c => (
                                        <tr key={c.id} style={{ borderColor: 'var(--bs-border-color)' }}>
                                            <td className="py-3 px-4">
                                                <div className="d-flex align-items-center gap-2">
                                                    <FileCode size={18} className="text-info flex-shrink-0" />
                                                    <div>
                                                        <span className="fw-bold d-block text-truncate" style={{ maxWidth: '240px' }}>{c.siteName}</span>
                                                        <span className="font-monospace text-secondary" style={{ fontSize: '10px' }}>{c.arquivo}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-3">
                                                <div className="d-flex align-items-center gap-2">
                                                    <span className="rounded-circle" style={{ width: '10px', height: '10px', background: c.colorHex || '#0ea5e9' }}></span>
                                                    <span className="small">{c.colorLabel}</span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-3 font-monospace small text-secondary">
                                                {Math.round((c.tamanhoBytes || 0) / 1024)} KB
                                            </td>
                                            <td className="py-3 px-3 small text-secondary">
                                                {c.criadoEm}
                                            </td>
                                            <td className="py-3 px-4 text-end">
                                                <div className="d-inline-flex align-items-center gap-2">
                                                    {c.xmlPath && (
                                                        <a
                                                            href={`/dashboard/preview/${c.id}`}
                                                            className="btn btn-outline-info btn-sm d-inline-flex align-items-center justify-content-center gap-1"
                                                            title="Pré-visualizar"
                                                            aria-label="Pré-visualizar"
                                                            style={{ minWidth: '44px' }}
                                                        >
                                                            <Eye size={14} /> <span className="d-none d-lg-inline">Preview</span>
                                                        </a>
                                                    )}
                                                    <a href={`/dashboard/compilacao/${c.id}/download`} title="Baixar" aria-label="Baixar" className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center justify-content-center gap-1" style={{ minWidth: '44px' }}>
                                                        <Download size={14} /> <span className="d-none d-lg-inline">Baixar</span>
                                                    </a>
                                                    <button
                                                        onClick={() => importarParaWorkspace(c.id)}
                                                        disabled={importandoId === c.id || importadosIds.has(c.id)}
                                                        className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center justify-content-center gap-1"
                                                        title="Importar para o Workspace"
                                                        aria-label={importadosIds.has(c.id) ? 'Importado para o Workspace' : 'Importar para o Workspace'}
                                                        style={{ minWidth: '44px' }}
                                                    >
                                                        {importandoId === c.id
                                                            ? <span className="spinner-border spinner-border-sm" role="status"></span>
                                                            : importadosIds.has(c.id)
                                                                ? <Check size={14} className="text-success" />
                                                                : <FolderSymlink size={14} />}
                                                        <span className="d-none d-lg-inline">{importadosIds.has(c.id) ? 'Importado' : 'Workspace'}</span>
                                                    </button>
                                                    <button
                                                        onClick={() => excluirCompilacao(c.id)}
                                                        disabled={excluindoId === c.id}
                                                        className="btn btn-outline-danger btn-sm d-inline-flex align-items-center justify-content-center"
                                                        title="Excluir template"
                                                        aria-label="Excluir template"
                                                        style={{ minWidth: '44px' }}
                                                    >
                                                        {excluindoId === c.id
                                                            ? <span className="spinner-border spinner-border-sm" role="status"></span>
                                                            : <Trash2 size={14} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
