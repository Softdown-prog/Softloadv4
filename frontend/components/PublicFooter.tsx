import React from 'react';

export default function PublicFooter(): React.JSX.Element {
    return (
        <footer className="sl-footer">
            <div className="container-xl">
                <div className="row g-4 mb-4">
                    <div className="col-12 col-md-6">
                        <a href="/" className="fw-black text-white text-decoration-none d-block mb-3 sl-brand" style={{ fontSize: '1.25rem' }}>
                            SOFTLOAD<span className="sl-accent">ENGINE</span>
                        </a>
                        <p className="mb-0 small" style={{ color: 'var(--sl-text-400)', maxWidth: 360, lineHeight: 1.7 }}>
                            Fundição industrial de alta performance para templates XML. Blindagem, velocidade e conversão para projetos exigentes.
                        </p>
                    </div>

                    <div className="col-6 col-md-3">
                        <h6 className="text-white fw-black text-uppercase mb-3" style={{ fontSize: 11, letterSpacing: '0.15em' }}>Acesso Restrito</h6>
                        <ul className="list-unstyled small fw-semibold mb-0">
                            <li className="mb-2"><a href="/register" className="sl-footer-link">Registre-se</a></li>
                            <li className="mb-2"><a href="/login" className="sl-footer-link">Painel de Controle</a></li>
                            <li className="mb-2"><a href="/#features" className="sl-footer-link">A Arquitetura</a></li>
                        </ul>
                    </div>

                    <div className="col-6 col-md-3">
                        <h6 className="text-white fw-black text-uppercase mb-3" style={{ fontSize: 11, letterSpacing: '0.15em' }}>Protocolos</h6>
                        <ul className="list-unstyled small fw-semibold mb-0">
                            <li className="mb-2"><a href="/contato" className="sl-footer-link">Contato</a></li>
                            <li className="mb-2"><a href="https://suporte.analysepro.com/" className="sl-footer-link" target="_blank" rel="noopener">Blog e Dúvidas</a></li>
                            <li className="mb-2"><a href="/termos-de-uso" className="sl-footer-link">Termos de Uso</a></li>
                            <li className="mb-2"><a href="/privacidade" className="sl-footer-link">Privacidade de Dados</a></li>
                        </ul>
                    </div>
                </div>

                <div className="d-flex flex-column flex-md-row justify-content-between align-items-center gap-3 pt-3"
                     style={{ borderTop: '1px solid var(--sl-bg-800)' }}>
                    <p className="mb-0 font-monospace text-uppercase"
                       style={{ fontSize: 11, color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>
                        &copy; 2026 Softload Engine. Todos os direitos reservados.
                    </p>
                    <div className="d-flex align-items-center gap-2 px-3 py-2 rounded"
                         style={{ background: 'var(--sl-bg-900)', border: '1px solid var(--sl-bg-800)' }}>
                        <span className="rounded-circle sl-pulse"
                              style={{ width: 8, height: 8, background: '#22c55e', display: 'inline-block', boxShadow: '0 0 8px rgba(34,197,94,0.8)' }}></span>
                        <span className="font-monospace text-uppercase"
                              style={{ fontSize: 10, color: 'var(--sl-text-300)', letterSpacing: '0.15em' }}>Sistemas Operacionais</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
