import React from 'react';

export default function PublicFooter(): React.JSX.Element {
    return (
        <footer className="sl-footer" aria-label="Informações e links da Softload">
            <div className="container-xl">
                <div className="row g-4 mb-4">
                    <div className="col-12 col-lg-4">
                        <a href="/" className="fw-black text-white text-decoration-none d-block mb-3 sl-brand" style={{ fontSize: '1.25rem' }}>
                            SOFTLOAD<span className="sl-accent"> V4</span>
                        </a>
                        <p className="mb-0 small" style={{ color: 'var(--sl-text-400)', maxWidth: 340, lineHeight: 1.7 }}>
                            Solaris Code para desenvolver e revisar código, IA Especialista Blogger e Workspace para projetos e templates XML.
                        </p>
                    </div>

                    <div className="col-6 col-sm-4 col-lg-3">
                        <h2 className="sl-footer-heading">Ferramentas</h2>
                        <ul className="list-unstyled small fw-semibold mb-0">
                            <li className="mb-2"><a href="/#demo-solaris" className="sl-footer-link">Solaris Code</a></li>
                            <li className="mb-2"><a href="/#ia-pode" className="sl-footer-link">Especialista Blogger</a></li>
                            <li className="mb-2"><a href="/#features" className="sl-footer-link">Workspace XML</a></li>
                            <li className="mb-2"><a href="/#solucoes" className="sl-footer-link">Todas as ferramentas</a></li>
                        </ul>
                    </div>

                    <div className="col-6 col-sm-4 col-lg-2">
                        <h2 className="sl-footer-heading">Sua conta</h2>
                        <ul className="list-unstyled small fw-semibold mb-0">
                            <li className="mb-2"><a href="/register" className="sl-footer-link">Criar conta grátis</a></li>
                            <li className="mb-2"><a href="/login" className="sl-footer-link">Entrar</a></li>
                            <li className="mb-2"><a href="/dashboard" className="sl-footer-link">Painel de controle</a></li>
                        </ul>
                    </div>

                    <div className="col-12 col-sm-4 col-lg-3">
                        <h2 className="sl-footer-heading">Ajuda e políticas</h2>
                        <ul className="list-unstyled small fw-semibold mb-0">
                            <li className="mb-2"><a href="/contato" className="sl-footer-link">Contato</a></li>
                            <li className="mb-2"><a href="https://suporte.analysepro.com/" className="sl-footer-link" target="_blank" rel="noopener noreferrer">Blog e dúvidas <span aria-hidden="true">↗</span></a></li>
                            <li className="mb-2"><a href="/termos-de-uso" className="sl-footer-link">Termos de Uso</a></li>
                            <li className="mb-2"><a href="/privacidade" className="sl-footer-link">Política de Privacidade</a></li>
                        </ul>
                    </div>
                </div>

                <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3 pt-3"
                     style={{ borderTop: '1px solid var(--sl-bg-800)' }}>
                    <p className="mb-0 small" style={{ color: 'var(--sl-text-500)' }}>
                        &copy; 2026 Softload V4. Todos os direitos reservados.
                    </p>
                    <span className="small" style={{ color: 'var(--sl-text-400)' }}>
                        Solaris Code · Blogger · Workspace
                    </span>
                </div>
            </div>
        </footer>
    );
}
