import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Monitor, Tablet, Smartphone, Download, Eye, AlertTriangle } from 'lucide-react';
import Pill from '../components/Pill';

interface PreviewData {
    siteName?: string;
    compilacaoId?: string;
    nichoTema?: string;
    from?: 'workspace' | 'historico' | string;
    previewHtml?: string;
    erro?: string;
}
type PreviewViewport = keyof typeof VIEWPORTS;

const VIEWPORTS = {
    desktop: { maxWidth: '1280px', label: '1280px — Desktop', icon: Monitor },
    tablet:  { maxWidth: '768px',  label: '768px — Tablet',   icon: Tablet },
    mobile:  { maxWidth: '390px',  label: '390px — Mobile',   icon: Smartphone },
};

// Script injetado dentro do iframe para reportar a altura real do conteúdo
// via postMessage — mais confiável que ler contentDocument.scrollHeight
// de fora, que em vários browsers retorna a altura do próprio viewport.
function buildHeightScript(): string {
    return `<script>(function(){
        function send(){ window.parent.postMessage({ type: 'sl-height', h: document.body.scrollHeight || document.documentElement.scrollHeight }, '*'); }
        window.addEventListener('load', function(){ setTimeout(send, 200); });
        new MutationObserver(function(){ setTimeout(send, 100); }).observe(document.body, { childList: true, subtree: true });
        setTimeout(send, 800);
    })()</` + `script>`;
}

export default function Preview(): React.JSX.Element {
    const { id } = useParams();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const isSession = location.pathname.endsWith('/session');

    const [data, setData] = useState<PreviewData | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [viewport, setViewport] = useState<PreviewViewport>('desktop');
    const [iframeHeight, setIframeHeight] = useState(780);

    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    useEffect(() => {
        let cancelled = false;

        const url = isSession
            ? '/api/preview/session'
            : `/api/preview/${id}?from=${searchParams.get('from') === 'workspace' ? 'workspace' : 'historico'}`;

        setLoading(true);
        setError('');

        fetch(url)
            .then(async (res) => {
                const body = await res.json().catch(() => ({})) as PreviewData;
                if (!res.ok) throw new Error(body.erro || 'Falha ao carregar preview.');
                return body;
            })
            .then((body) => { if (!cancelled) setData(body); })
            .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar preview.'); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [id, isSession, searchParams]);

    // Escuta a mensagem de altura vinda do iframe
    useEffect(() => {
        function onMessage(e: MessageEvent): void {
            if (e.data && e.data.type === 'sl-height' && e.data.h > 200) {
                setIframeHeight(Math.min(e.data.h + 60, 8000));
            }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    // Reme a altura direto (iframe tem allow-same-origin) depois que a
    // transição CSS de max-width termina — uma mudança de largura vinda
    // do pai não dispara o script injetado sozinho.
    const remedirAposTransicao = (): void => {
        setTimeout(() => {
            try {
                const doc = iframeRef.current?.contentDocument;
                const h = doc?.body?.scrollHeight || doc?.documentElement?.scrollHeight;
                if (h != null && h > 200) setIframeHeight(Math.min(h + 60, 8000));
            } catch (_) { /* cross-origin ou iframe não pronto — ignora */ }
        }, 320);
    };

    const handleSetViewport = (vp: PreviewViewport): void => {
        if (vp === viewport) return;
        setViewport(vp);
        remedirAposTransicao();
    };

    if (loading) {
        return (
            <div className="d-flex align-items-center justify-content-center flex-grow-1" style={{ minHeight: '60vh' }}>
                <div className="spinner-border text-info" role="status" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1 text-center p-4" style={{ minHeight: '60vh' }}>
                <AlertTriangle size={28} className="text-warning mb-3" />
                <p className="text-secondary mb-3">{error || 'Preview indisponível.'}</p>
                <Link to={isSession ? '/dashboard/workspace' : '/dashboard/historico'} className="btn btn-sl-outline btn-sm">
                    Voltar
                </Link>
            </div>
        );
    }

    const { siteName, compilacaoId, nichoTema, from } = data;
    const backTo = from === 'workspace' ? '/dashboard/workspace' : '/dashboard/historico';
    const backLabel = from === 'workspace' ? 'Workspace' : 'Histórico';
    const iframeContent = (data.previewHtml || '') + buildHeightScript();

    return (
        <div className="d-flex flex-column flex-grow-1" style={{ minHeight: 0, overflow: 'hidden' }}>
            {/* Barra de controles */}
            <div className="flex-shrink-0 px-3 px-md-4 py-2" style={{ borderBottom: '1px solid var(--bs-border-color)', background: 'var(--sl-bg-900)' }}>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    <Link to={backTo} className="btn fw-bolder text-uppercase d-flex align-items-center gap-1 flex-shrink-0"
                        style={{ fontSize: '11px', letterSpacing: '0.06em', background: 'var(--sl-bg-800)', color: 'var(--sl-text-400)', border: 'none', padding: '6px 10px', minHeight: '34px' }}>
                        <ArrowLeft size={14} />
                        <span>{backLabel}</span>
                    </Link>

                    <div className="d-flex align-items-center gap-2 flex-grow-1" style={{ minWidth: 0 }}>
                        <Eye size={14} style={{ color: 'var(--sl-primary)' }} className="flex-shrink-0" />
                        <span className="fw-bold small text-truncate">{siteName}</span>
                        <Pill tone="primary" className="flex-shrink-0">Preview</Pill>
                        {nichoTema && (
                            <Pill tone="muted" uppercase={false} className="flex-shrink-0 d-none d-sm-inline">{nichoTema}</Pill>
                        )}
                    </div>

                    <div className="d-flex align-items-center gap-1 flex-shrink-0">
                        <div className="btn-group" role="group" aria-label="Viewport">
                            {Object.entries(VIEWPORTS).map(([key, cfg]) => {
                                const Icon = cfg.icon;
                                const active = viewport === key;
                                return (
                                    <button key={key} type="button" onClick={() => handleSetViewport(key as PreviewViewport)} title={cfg.label} aria-label={cfg.label}
                                        className="btn"
                                        style={{
                                            minHeight: '36px', padding: '6px 12px', fontSize: '.85rem',
                                            background: active ? 'var(--sl-primary)' : 'var(--sl-bg-800)',
                                            color: active ? '#fff' : 'var(--sl-text-400)',
                                            border: `1px solid ${active ? 'var(--sl-primary)' : 'var(--bs-border-color)'}`,
                                        }}>
                                        <Icon size={14} />
                                    </button>
                                );
                            })}
                        </div>

                        {compilacaoId && (
                            <a href={`/dashboard/compilacao/${compilacaoId}/download`}
                                className="btn fw-bolder text-uppercase d-flex align-items-center gap-1"
                                style={{ minHeight: '36px', padding: '6px 12px', fontSize: '11px', letterSpacing: '0.06em', background: 'var(--sl-primary)', color: '#fff', border: 'none', textDecoration: 'none' }}>
                                <Download size={13} />
                                <span>Baixar</span>
                            </a>
                        )}
                    </div>
                </div>
            </div>

            {/* Área do stage + iframe */}
            <div className="flex-grow-1 d-flex flex-column align-items-center" style={{ background: '#1a1f2e', padding: '16px 12px', overflowY: 'auto' }}>
                <div style={{ width: '100%', maxWidth: VIEWPORTS[viewport].maxWidth, transition: 'max-width .3s cubic-bezier(.4,0,.2,1)', flexShrink: 0 }}>
                    <div style={{ background: '#2a2f3e', borderRadius: '10px 10px 0 0', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                        <span style={{ fontSize: 10, color: '#64748b', marginLeft: 6, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                            {VIEWPORTS[viewport].label}
                        </span>
                    </div>

                    <iframe
                        ref={iframeRef}
                        title="Preview do template"
                        srcDoc={iframeContent}
                        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                        style={{ width: '100%', height: `${iframeHeight}px`, border: 'none', borderRadius: '0 0 10px 10px', background: '#fff', display: 'block' }}
                    />
                </div>

                <div style={{ width: '100%', maxWidth: VIEWPORTS[viewport].maxWidth, marginTop: 10, padding: '10px 14px', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: '1rem', lineHeight: 1.4, flexShrink: 0 }}>⚠️</span>
                    <p style={{ margin: 0, fontSize: '.75rem', lineHeight: 1.5, color: '#b0976b' }}>
                        <strong style={{ color: '#d4a84b' }}>Visualização aproximada (~80%).</strong>{' '}
                        Fontes externas, scripts de terceiros e alguns efeitos CSS ficam bloqueados pelo sandbox de segurança.
                        Quebras de layout nesta tela são comuns e <em>não refletem a qualidade final</em> do template publicado no Blogger.
                    </p>
                </div>
            </div>
        </div>
    );
}
