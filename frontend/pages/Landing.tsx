import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleCheckBig, X } from 'lucide-react';
import useHeroEntrance from '../hooks/useHeroEntrance';
import TerminalDemo from '../components/landing/TerminalDemo';
import CapabilityChecklist from '../components/landing/CapabilityChecklist';

const CHIPS = [
    { cor: '#38bdf8', borda: 'rgba(56,189,248,.25)', bg: 'rgba(56,189,248,.05)', label: 'Solaris Code' },
    { cor: '#4ade80', borda: 'rgba(74,222,128,.25)', bg: 'rgba(74,222,128,.05)', label: 'IA Especialista Blogger' },
    { cor: '#f472b6', borda: 'rgba(244,114,182,.25)', bg: 'rgba(244,114,182,.05)', label: 'Workspace XML' },
    { cor: '#818cf8', borda: 'rgba(129,140,248,.25)', bg: 'rgba(129,140,248,.05)', label: 'Integração GitHub' },
];

const FEATURES = [
    {
        cor: '#38bdf8', bg: 'rgba(56,189,248,.1)', titulo: 'IA Especialista em Blogger',
        path: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
        desc: <>Chat treinado com a estrutura real do Blogspot: <code style={{ color: '#38bdf8', background: 'rgba(56,189,248,.08)', padding: '1px 4px', borderRadius: 3 }}>b:section</code>, <code style={{ color: '#38bdf8', background: 'rgba(56,189,248,.08)', padding: '1px 4px', borderRadius: 3 }}>b:widget</code>, variáveis condicionais e gadgets. É uma ferramenta especializada para quem desenvolve templates.</>,
    },
    {
        cor: '#4ade80', bg: 'rgba(74,222,128,.1)', titulo: 'Compilador XML de Templates',
        path: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
        desc: <>Motor Node.js que monta e valida o XML em milissegundos. Gera um arquivo <code style={{ color: '#4ade80', background: 'rgba(74,222,128,.08)', padding: '1px 4px', borderRadius: 3 }}>.xml</code> pronto para importar no Blogspot — com módulos, grid e tipografia customizáveis.</>,
    },
    {
        cor: '#fb923c', bg: 'rgba(251,146,60,.1)', titulo: 'SEO + AdSense Automático',
        path: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
        desc: 'Meta tags, Open Graph, Schema.org e posicionamento estratégico de anúncios AdSense embutidos no template. Seu blog nasce SEO-ready.',
    },
    {
        cor: '#818cf8', bg: 'rgba(129,140,248,.1)', titulo: 'Gadgets e Automação de Widgets',
        path: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z',
        desc: <>Sidebar, header, rodapé, posts relacionados e widgets de categorias com estrutura nativa <code style={{ color: '#818cf8', background: 'rgba(129,140,248,.08)', padding: '1px 4px', borderRadius: 3 }}>b:widget</code> do Blogger, sem gambiarras.</>,
    },
    {
        cor: '#f472b6', bg: 'rgba(244,114,182,.1)', titulo: 'Workspace Completo',
        path: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
        desc: 'Editor visual, histórico com download, preview mobile em tempo real, chat IA e gestão de armazenamento — tudo em um painel unificado.',
    },
    {
        cor: '#22d3ee', bg: 'rgba(34,211,238,.1)', titulo: 'Templates Testados em Produção',
        path: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
        desc: 'Chassis (Boutique, MagTech, MegaGame) construídos sobre estrutura Blogger real. Core Web Vitals aprovado, responsivos e prontos para monetização.',
    },
];

const TICKER_ITENS = [
    '⚡ Tech Blog Pro', '🎮 MegaGame', '🛍 Boutique Store', '📰 MagTech News',
    '🌙 Dark Magazine', '⚽ Sports Hub', '🍕 Food & Travel', '🎵 Portfolio Clean',
    '💼 E-commerce BR', '📱 Minimal Blog', '🔬 Science Daily', '💰 Finance Pro',
];

function AccountDeletedToast(): React.JSX.Element | null {
    const [searchParams] = useSearchParams();
    const [visivel, setVisivel] = useState(searchParams.get('conta') === 'apagada');

    useEffect(() => {
        if (!visivel) return;
        const t = setTimeout(() => setVisivel(false), 6000);
        return () => clearTimeout(t);
    }, [visivel]);

    if (!visivel) return null;

    return (
        <div className="position-fixed bottom-0 start-0 end-0 p-2 p-sm-3 d-flex justify-content-end" style={{ zIndex: 9999 }}>
            <div role="status" aria-live="polite" className="d-flex align-items-center gap-3 rounded-3 px-4 py-3 shadow-lg"
                 style={{ background: 'rgba(15,23,42,.97)', border: '1px solid rgba(34,197,94,.3)', color: '#4ade80', width: '100%', maxWidth: 360 }}>
                <CircleCheckBig size={16} className="flex-shrink-0" />
                <div>
                    <p className="fw-bold mb-0 small">Conta excluída com sucesso.</p>
                    <p className="mb-0" style={{ fontSize: 11, opacity: .7 }}>Todos os seus dados foram removidos permanentemente.</p>
                </div>
                <button onClick={() => setVisivel(false)} className="btn btn-link p-0 ms-auto" style={{ color: '#4ade80', lineHeight: 1 }} aria-label="Fechar">
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}

export default function Landing(): React.JSX.Element {
    const [demoStart, setDemoStart] = useState<boolean>(false);
    useHeroEntrance(useCallback(() => setDemoStart(true), []));

    return (
        <main className="min-vh-100 sl-pt-nav" style={{ background: 'var(--sl-bg-950)', color: 'var(--sl-text-300)' }}>
            <AccountDeletedToast />

            {/* ═══════════════════════════════════════ HERO ═══════════════════════════════════════ */}
            <section className="position-relative overflow-hidden" style={{ paddingTop: '6.5rem', paddingBottom: '5rem' }}>
                <div className="position-absolute" style={{ inset: 0, backgroundImage: 'linear-gradient(rgba(14,165,233,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,.04) 1px,transparent 1px)', backgroundSize: '48px 48px', pointerEvents: 'none', zIndex: 0 }}></div>
                <div className="position-absolute" style={{ width: 700, height: 700, background: 'radial-gradient(circle,rgba(14,165,233,.14),transparent 65%)', top: -180, left: -120, pointerEvents: 'none', zIndex: 0 }}></div>
                <div className="position-absolute" style={{ width: 500, height: 500, background: 'radial-gradient(circle,rgba(99,102,241,.1),transparent 65%)', bottom: -80, right: '5%', pointerEvents: 'none', zIndex: 0 }}></div>

                <div className="container" style={{ maxWidth: 1280, position: 'relative', zIndex: 1 }}>
                    <div className="row align-items-center g-5">

                        {/* LEFT: Copy */}
                        <div className="col-lg-6 col-xl-5">
                            <div data-hero="badge" className="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill border mb-4 font-monospace"
                                 style={{ background: 'rgba(14,165,233,.07)', borderColor: 'rgba(14,165,233,.2)', fontSize: 11, color: 'var(--sl-primary-light)' }}>
                                <span className="sl-pulse rounded-circle" style={{ width: 6, height: 6, background: 'var(--sl-primary-light)', flexShrink: 0, display: 'inline-block' }}></span>
                                SOFTLOAD V4 · FERRAMENTAS DE IA
                            </div>
                            <h1 className="fw-bolder text-white mb-4" style={{ fontSize: 'clamp(2rem,5vw,3.6rem)', letterSpacing: '-.03em', lineHeight: 1.15, fontWeight: 900 }}>
                                <span className="hero-mask"><span className="hero-mask__inner" data-hero-line>Desenvolva projetos</span></span>
                                <span className="hero-mask"><span className="hero-mask__inner" data-hero-line>e crie <span style={{ background: 'linear-gradient(90deg,#38bdf8,#818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>com IA</span></span></span>
                            </h1>
                            <p data-hero="lead" className="mb-4" style={{ fontSize: '1.05rem', color: 'var(--sl-text-400)', lineHeight: 1.75, maxWidth: 480 }}>
                                Solaris Code para desenvolvimento e revisão de código, IA especialista em Blogger e um Workspace para criar e organizar templates XML.
                            </p>
                            <div data-hero="chips" className="d-flex flex-wrap gap-2 mb-5">
                                {CHIPS.map((chip) => (
                                    <span key={chip.label} className="chip-item px-3 py-1 rounded-pill border font-monospace"
                                          style={{ fontSize: 11, color: 'var(--sl-text-300)', borderColor: chip.borda, background: chip.bg }}>
                                        <span style={{ color: chip.cor }}>●</span> {chip.label}
                                    </span>
                                ))}
                            </div>
                            <div data-hero="cta" className="d-flex flex-column flex-sm-row gap-3">
                                <a href="/register" className="btn btn-sl-primary fw-bold px-5 py-3 d-flex align-items-center gap-2 justify-content-center"
                                   style={{ fontSize: '1rem', boxShadow: '0 0 40px -8px rgba(56,189,248,.5)' }}>
                                    Criar conta grátis
                                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                                </a>
                                <a href="#solucoes" className="btn fw-bold px-5 py-3 d-flex align-items-center gap-2 justify-content-center"
                                   style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--sl-bg-800)', color: 'var(--sl-text-300)', fontSize: '1rem' }}>
                                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    Conhecer ferramentas
                                </a>
                            </div>
                            <p data-hero="trust" className="mt-4 mb-0 small" style={{ color: 'var(--sl-text-500)' }}>
                                <svg className="me-1" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ verticalAlign: 'middle' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                                Cadastro grátis e sem cartão de crédito · Funcionalidades variam conforme o plano
                            </p>
                        </div>

                        {/* RIGHT: Mockup Panel */}
                        <div className="col-lg-6 col-xl-7 d-none d-lg-flex justify-content-center">
                            <div data-hero="panel" className="position-relative w-100" style={{ maxWidth: 620 }}>
                                <div className="rounded-4 overflow-hidden" style={{ background: '#080e1c', border: '1px solid rgba(56,189,248,.18)', boxShadow: '0 0 100px -25px rgba(56,189,248,.3),0 30px 80px -20px rgba(0,0,0,.7)' }}>
                                    <div className="d-flex align-items-center gap-3 px-4 py-3" style={{ background: 'rgba(255,255,255,.02)', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                                        <div className="d-flex gap-1">
                                            <span className="rounded-circle" style={{ width: 10, height: 10, background: '#ff5f57', display: 'inline-block' }}></span>
                                            <span className="rounded-circle" style={{ width: 10, height: 10, background: '#febc2e', display: 'inline-block' }}></span>
                                            <span className="rounded-circle" style={{ width: 10, height: 10, background: '#28c840', display: 'inline-block' }}></span>
                                        </div>
                                        <div className="d-flex ms-3 rounded-2 overflow-hidden" style={{ border: '1px solid rgba(255,255,255,.07)' }}>
                                            <span className="px-3 py-1 font-monospace" style={{ fontSize: 11, color: '#38bdf8', background: 'rgba(56,189,248,.1)', borderRight: '1px solid rgba(255,255,255,.07)' }}>Workspace</span>
                                            <span className="px-3 py-1 font-monospace" style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', borderRight: '1px solid rgba(255,255,255,.07)' }}>Chat IA</span>
                                            <span className="px-3 py-1 font-monospace" style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>Preview</span>
                                        </div>
                                        <div className="ms-auto">
                                            <span className="compile-pulse rounded-pill px-2 py-1 font-monospace" style={{ fontSize: 10, background: 'rgba(74,222,128,.1)', color: '#4ade80' }}>● COMPILANDO</span>
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        <div className="row g-3">
                                            <div className="col-12">
                                                <div className="rounded-3 overflow-hidden" style={{ background: '#050a14', border: '1px solid rgba(255,255,255,.06)' }}>
                                                    <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: 'rgba(255,255,255,.02)', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                                                        <span className="rounded-circle" style={{ width: 6, height: 6, background: 'rgba(56,189,248,.5)', display: 'inline-block' }}></span>
                                                        <span className="font-monospace" style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>template.xml</span>
                                                        <span className="ms-auto rounded-pill px-2 font-monospace" style={{ fontSize: 9, background: 'rgba(99,102,241,.15)', color: '#818cf8' }}>Blogger XML</span>
                                                    </div>
                                                    <pre className="mb-0 px-4 py-3" style={{ fontSize: 11.5, lineHeight: 1.85, overflow: 'hidden', fontFamily: "'Courier New',monospace" }}>
<code>
<span style={{ color: '#6272a4' }}>{'<!-- IA: Tech Blog Pro — SEO ✓ AdSense ✓ -->'}</span>{'\n'}
<span style={{ color: '#ff79c6' }}>{'<b:section'}</span> <span style={{ color: '#50fa7b' }}>id</span>=<span style={{ color: '#f1fa8c' }}>'header'</span> <span style={{ color: '#50fa7b' }}>maxwidgets</span>=<span style={{ color: '#f1fa8c' }}>'1'</span> <span style={{ color: '#50fa7b' }}>showaddelement</span>=<span style={{ color: '#f1fa8c' }}>'no'</span><span style={{ color: '#ff79c6' }}>{'>'}</span>{'\n'}
  <span style={{ color: '#ff79c6' }}>{'<b:widget'}</span> <span style={{ color: '#50fa7b' }}>id</span>=<span style={{ color: '#f1fa8c' }}>'Header1'</span> <span style={{ color: '#50fa7b' }}>type</span>=<span style={{ color: '#f1fa8c' }}>'Header'</span> <span style={{ color: '#50fa7b' }}>locked</span>=<span style={{ color: '#f1fa8c' }}>'true'</span><span style={{ color: '#ff79c6' }}>{'>'}</span>{'\n'}
    <span style={{ color: '#8be9fd' }}>{"<b:includable id='main'>"}</span>{'\n'}
      <span style={{ color: '#ff79c6' }}>{'<data:blog.pageTitle/>'}</span>{'\n'}
    <span style={{ color: '#8be9fd' }}>{'</b:includable>'}</span>{'\n'}
  <span style={{ color: '#ff79c6' }}>{'</b:widget>'}</span>{'\n'}
<span style={{ color: '#ff79c6' }}>{'</b:section>'}</span><span className="cursor" style={{ color: '#38bdf8' }}>▌</span>
</code>
                                                    </pre>
                                                </div>
                                            </div>
                                            <div className="col-12 col-sm-7">
                                                <div className="d-flex gap-2 align-items-start mb-3">
                                                    <div className="rounded-2 d-flex align-items-center justify-content-center flex-shrink-0 fw-bold"
                                                         style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#38bdf8,#6366f1)', fontSize: 10, color: 'white', fontFamily: 'monospace' }}>IA</div>
                                                    <div className="rounded-3 px-3 py-2 flex-fill" style={{ background: 'rgba(56,189,248,.07)', border: '1px solid rgba(56,189,248,.15)' }}>
                                                        <p className="mb-0" style={{ fontSize: 11.5, color: 'var(--sl-text-300)', lineHeight: 1.6 }}>Template <strong style={{ color: '#38bdf8' }}>Tech Blog Pro</strong> gerado. SEO ativo, 4 slots AdSense, sidebar com gadgets.<span className="cursor" style={{ color: '#38bdf8', fontSize: 10 }}> ▌</span></p>
                                                    </div>
                                                </div>
                                                <div className="d-flex gap-2 align-items-start justify-content-end">
                                                    <div className="rounded-3 px-3 py-2" style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.15)', maxWidth: '85%' }}>
                                                        <p className="mb-0" style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 1.5 }}>"blog de tecnologia, foco em AdSense, tema escuro"</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="col-12 col-sm-5">
                                                <div className="d-flex flex-column gap-2 h-100 justify-content-center">
                                                    <div className="d-flex align-items-center justify-content-between rounded-3 px-3 py-2" style={{ background: 'rgba(74,222,128,.05)', border: '1px solid rgba(74,222,128,.15)' }}>
                                                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', fontFamily: 'monospace' }}>SEO Score</span>
                                                        <span className="fw-bold font-monospace" style={{ color: '#4ade80', fontSize: '1rem' }}>98</span>
                                                    </div>
                                                    <div className="d-flex align-items-center justify-content-between rounded-3 px-3 py-2" style={{ background: 'rgba(251,146,60,.05)', border: '1px solid rgba(251,146,60,.15)' }}>
                                                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', fontFamily: 'monospace' }}>AdSense</span>
                                                        <span className="fw-bold font-monospace" style={{ color: '#fb923c', fontSize: '1rem' }}>4 slots</span>
                                                    </div>
                                                    <div className="d-flex align-items-center justify-content-between rounded-3 px-3 py-2" style={{ background: 'rgba(129,140,248,.05)', border: '1px solid rgba(129,140,248,.15)' }}>
                                                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', fontFamily: 'monospace' }}>LCP</span>
                                                        <span className="fw-bold font-monospace" style={{ color: '#818cf8', fontSize: '1rem' }}>0.8s</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="d-flex align-items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,.05)', background: 'rgba(255,255,255,.01)' }}>
                                        <span className="font-monospace" style={{ fontSize: 10, color: '#4ade80' }}>✓ Compilado em 320ms</span>
                                        <div className="ms-auto d-flex gap-2">
                                            <span className="rounded-2 px-2 py-1 font-monospace" style={{ fontSize: 9, background: 'rgba(56,189,248,.08)', color: '#38bdf8', border: '1px solid rgba(56,189,248,.15)' }}>Preview</span>
                                            <span className="rounded-2 px-2 py-1 font-monospace" style={{ fontSize: 9, background: 'rgba(74,222,128,.08)', color: '#4ade80', border: '1px solid rgba(74,222,128,.15)' }}>↓ Baixar .xml</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Floating mobile frame */}
                                <div className="position-absolute d-none d-xl-block" style={{ bottom: -24, right: -52, width: 110, zIndex: 2 }}>
                                    <div className="rounded-4 overflow-hidden" style={{ background: '#050a14', border: '2px solid rgba(56,189,248,.25)', boxShadow: '0 20px 50px rgba(0,0,0,.6)' }}>
                                        <div className="text-center py-1" style={{ background: 'rgba(56,189,248,.04)', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                                            <span className="rounded-pill d-inline-block" style={{ width: 28, height: 4, background: 'rgba(255,255,255,.1)' }}></span>
                                        </div>
                                        <div className="px-2 pt-2 pb-3">
                                            <div className="rounded-1 mb-2" style={{ height: 36, background: 'linear-gradient(135deg,rgba(56,189,248,.15),rgba(99,102,241,.15))', border: '1px solid rgba(56,189,248,.1)' }}></div>
                                            <div className="rounded-1 mb-1" style={{ height: 5, background: 'rgba(255,255,255,.08)', width: '90%' }}></div>
                                            <div className="rounded-1 mb-1" style={{ height: 5, background: 'rgba(255,255,255,.06)', width: '70%' }}></div>
                                            <div className="rounded-1 mb-2" style={{ height: 5, background: 'rgba(255,255,255,.04)', width: '85%' }}></div>
                                            <div className="d-flex gap-1">
                                                <div className="rounded-1 flex-fill" style={{ height: 28, background: 'rgba(251,146,60,.1)', border: '1px solid rgba(251,146,60,.15)' }}></div>
                                                <div className="rounded-1 flex-fill" style={{ height: 28, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.15)' }}></div>
                                            </div>
                                            <div className="mt-2 text-center"><span className="font-monospace" style={{ fontSize: 7, color: 'rgba(255,255,255,.3)' }}>mobile preview</span></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Floating badge top-left */}
                                <div className="position-absolute d-none d-xl-block" style={{ top: -18, left: -28, zIndex: 2 }}>
                                    <div className="rounded-3 px-3 py-2 d-flex align-items-center gap-2" style={{ background: 'rgba(5,10,20,.95)', border: '1px solid rgba(74,222,128,.25)', boxShadow: '0 8px 30px rgba(0,0,0,.4)' }}>
                                        <svg width="14" height="14" fill="none" stroke="#4ade80" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                                        <span className="font-monospace" style={{ fontSize: 10, color: '#4ade80', whiteSpace: 'nowrap' }}>Estrutura Blogger real</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </section>


            {/* ═══════════════════════════════ SOLUÇÕES DA SOFTLOAD ═══════════════════════════════ */}
            <section id="solucoes" className="py-5 border-top" style={{ borderColor: 'var(--sl-bg-900)', scrollMarginTop: '5rem' }}>
                <div className="container" style={{ maxWidth: 1200 }}>
                    <div className="text-center mb-5">
                        <p className="text-uppercase fw-bold font-monospace mb-2" style={{ color: 'var(--sl-primary-light)', fontSize: 11, letterSpacing: '0.15em' }}>Uma plataforma, ferramentas especializadas</p>
                        <h2 className="fw-bolder text-white mb-3" style={{ fontSize: 'clamp(1.6rem,4vw,2.6rem)', letterSpacing: '-.02em' }}>
                            Escolha a ferramenta certa para seu projeto
                        </h2>
                        <p style={{ color: 'var(--sl-text-400)', maxWidth: 610, margin: '0 auto', lineHeight: 1.7 }}>
                            Conheça as áreas disponíveis na Softload V4. O acesso a cada recurso depende do seu plano.
                        </p>
                    </div>
                    <div className="row g-4">
                        {[
                            {
                                tag: 'DESENVOLVIMENTO', titulo: 'Solaris Code',
                                desc: 'Converse sobre código, analise projetos e trabalhe com repositórios GitHub por meio das ferramentas de IA disponíveis.',
                                href: '/register', link: 'Conhecer Solaris Code', cor: '#38bdf8',
                            },
                            {
                                tag: 'BLOGGER E BLOGSPOT', titulo: 'Especialista Blogger',
                                desc: 'Assistência para XML, widgets, CSS e SEO de templates Blogger, com exemplos de respostas da IA na demonstração.',
                                href: '/#ia-pode', link: 'Ver demonstração', cor: '#4ade80',
                            },
                            {
                                tag: 'GERAÇÃO DE TEMPLATES', titulo: 'Workspace',
                                desc: 'Organize seus projetos e crie templates XML com o compilador disponível nos planos compatíveis.',
                                href: '/#features', link: 'Explorar recursos', cor: '#f472b6',
                            },
                        ].map((solucao) => (
                            <div key={solucao.titulo} className="col-12 col-md-4">
                                <article className="rounded-4 border p-4 h-100 d-flex flex-column" style={{ background: 'rgba(15,23,42,.5)', borderColor: 'var(--sl-bg-800)' }}>
                                    <p className="fw-bold font-monospace mb-3" style={{ color: solucao.cor, fontSize: 11, letterSpacing: '0.1em' }}>{solucao.tag}</p>
                                    <h3 className="h4 fw-bold text-white mb-3">{solucao.titulo}</h3>
                                    <p className="small flex-grow-1" style={{ color: 'var(--sl-text-400)', lineHeight: 1.8 }}>{solucao.desc}</p>
                                    <a className="fw-bold text-decoration-none mt-2" style={{ color: solucao.cor }} href={solucao.href}>{solucao.link} <span aria-hidden="true">→</span></a>
                                </article>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ═══════════════════════════════════ FEATURES ═══════════════════════════════════ */}
            <section id="features" className="py-5 border-top" style={{ borderColor: 'var(--sl-bg-900)', paddingTop: '5rem', paddingBottom: '5rem', scrollMarginTop: '5rem' }}>
                <div className="container" style={{ maxWidth: 1200 }}>
                    <div className="text-center mb-5">
                        <div className="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill border mb-3 font-monospace"
                             style={{ background: 'var(--sl-bg-900)', borderColor: 'var(--sl-bg-800)', fontSize: 11, color: 'var(--sl-text-400)' }}>FERRAMENTAS PARA BLOGGER</div>
                        <h2 className="fw-bolder text-white mb-2" style={{ fontSize: 'clamp(1.6rem,4vw,2.6rem)', fontWeight: 900, letterSpacing: '-.02em' }}>
                            Do projeto ao XML pronto.<br />
                            <span style={{ background: 'linear-gradient(90deg,#38bdf8,#818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Ferramentas especializadas em Blogger.</span>
                        </h2>
                        <p style={{ color: 'var(--sl-text-500)', maxWidth: 540, margin: '0 auto', fontSize: '1rem' }}>
                            Construída por quem conhece a estrutura interna do Blogspot — do XML aos gadgets.
                        </p>
                    </div>
                    <div className="row g-4">
                        {FEATURES.map((f) => (
                            <div key={f.titulo} className="col-12 col-sm-6 col-lg-4">
                                <div className="feat-card h-100 rounded-4 border p-4" style={{ background: 'rgba(15,23,42,.5)', borderColor: 'var(--sl-bg-800)', backdropFilter: 'blur(20px)' }}>
                                    <div className="rounded-3 d-flex align-items-center justify-content-center mb-4" style={{ width: 48, height: 48, background: f.bg, color: f.cor }}>
                                        <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={f.path} /></svg>
                                    </div>
                                    <h3 className="fw-bold text-white mb-2" style={{ fontSize: '1.05rem' }}>{f.titulo}</h3>
                                    <p className="small mb-0" style={{ color: 'var(--sl-text-400)', lineHeight: 1.75 }}>{f.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ══════════════════════════════ O QUE A IA CONSEGUE FAZER ══════════════════════════════ */}
            <section id="ia-pode" className="py-5 position-relative overflow-hidden" style={{ borderTop: '1px solid rgba(255,255,255,.04)', paddingTop: '5rem', paddingBottom: '5rem', scrollMarginTop: '5rem' }}>
                <div className="position-absolute" style={{ inset: 0, background: 'linear-gradient(180deg,transparent 0%,rgba(99,102,241,.04) 50%,transparent 100%)', pointerEvents: 'none' }}></div>
                <div className="position-absolute" style={{ width: 600, height: 600, background: 'radial-gradient(circle,rgba(99,102,241,.07),transparent 65%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}></div>

                <div className="container position-relative" style={{ maxWidth: 1200 }}>
                    <div className="text-center mb-5">
                        <div className="d-inline-flex align-items-center gap-2 px-3 py-1 rounded-pill border mb-3 font-monospace"
                             style={{ background: 'rgba(99,102,241,.08)', borderColor: 'rgba(99,102,241,.2)', fontSize: 11, color: '#818cf8' }}>
                            <span className="sl-pulse rounded-circle" style={{ width: 6, height: 6, background: '#818cf8', flexShrink: 0, display: 'inline-block' }}></span>
                            O QUE A IA CONSEGUE FAZER
                        </div>
                        <h2 className="fw-bolder text-white mb-2" style={{ fontSize: 'clamp(1.6rem,4vw,2.6rem)', fontWeight: 900, letterSpacing: '-.02em' }}>
                            A IA que entende Blogger<br />
                            <span style={{ background: 'linear-gradient(90deg,#818cf8,#38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>por dentro</span>
                        </h2>
                        <p style={{ color: 'var(--sl-text-500)', maxWidth: 520, margin: '0 auto', fontSize: '1rem' }}>
                            Uma IA especializada na estrutura XML do Blogspot, com conhecimento aplicado à criação e personalização de templates.
                        </p>
                    </div>

                    <div className="row g-5 align-items-start mb-5">
                        <div className="col-lg-7">
                            <TerminalDemo start={demoStart} />
                        </div>
                        <div className="col-lg-5">
                            <CapabilityChecklist />
                        </div>
                    </div>

                    {/* Template ticker strip */}
                    <div className="ticker-wrap rounded-3 overflow-hidden" style={{ border: '1px solid rgba(255,255,255,.05)', background: 'rgba(255,255,255,.01)' }}>
                        <div className="ticker-track py-3 gap-3">
                            {[...TICKER_ITENS, ...TICKER_ITENS].map((label, i) => (
                                <span key={i} className="flex-shrink-0 rounded-pill px-4 py-2 font-monospace"
                                      style={{ fontSize: 11, color: 'var(--sl-text-400)', border: '1px solid rgba(255,255,255,.07)', background: 'rgba(15,23,42,.5)', whiteSpace: 'nowrap' }}>
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Bottom CTA */}
                    <div className="text-center mt-5 pt-2">
                        <a href="/register" className="btn btn-sl-primary fw-bold px-5 py-3 me-3" style={{ fontSize: '1rem', boxShadow: '0 0 40px -8px rgba(56,189,248,.4)' }}>
                            Começar gratuitamente
                        </a>
                        <a href="/login" className="btn fw-bold px-4 py-3" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--sl-bg-800)', color: 'var(--sl-text-400)', fontSize: '1rem' }}>
                            Já tenho conta
                        </a>
                    </div>
                </div>
            </section>
        </main>
    );
}
