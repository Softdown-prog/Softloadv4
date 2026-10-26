import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';

// Formulário nativo (method="POST" action="/login") de propósito — o backend
// (src/routes/authRoutes.js) responde com redirect 302 + Set-Cookie de sessão,
// não JSON. Um fetch() teria que reimplementar isso; a submissão nativa do
// navegador já faz exatamente o que o EJS antigo fazia, sem mudar o contrato
// de segurança (rate limit, sessão, redirects ?erro=/?sucesso=).
export default function Login(): React.JSX.Element {
    const [searchParams] = useSearchParams();
    const [showPwd, setShowPwd] = useState<boolean>(false);

    const erro = searchParams.get('erro');
    const sucesso = searchParams.get('sucesso');

    return (
        <main className="d-flex align-items-center justify-content-center px-3 sl-pt-nav"
              style={{ minHeight: '100vh', background: 'var(--sl-bg-950)', position: 'relative', overflow: 'hidden' }}>

            <div style={{ position: 'absolute', top: '25%', left: '25%', width: '384px', height: '384px', background: 'rgba(14,165,233,0.07)', borderRadius: '50%', filter: 'blur(120px)', pointerEvents: 'none' }}></div>

            <div style={{ width: '100%', maxWidth: '440px', position: 'relative', zIndex: 1 }}>

                {sucesso && (
                    <div className="alert alert-success fw-bold small text-center mb-4 rounded-3" role="alert">
                        {sucesso}
                    </div>
                )}

                {erro && (
                    <div className="alert alert-danger fw-bold small text-center mb-4 rounded-3" role="alert">
                        {erro}
                    </div>
                )}

                <div className="rounded-4 p-4 p-sm-5"
                     style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(24px)', border: '1px solid var(--sl-bg-800)' }}>

                    <div className="text-center mb-4">
                        <h1 className="fw-black text-white text-uppercase mb-1" style={{ letterSpacing: '-0.03em' }}>Acesse sua conta</h1>
                        <p className="fw-bold text-uppercase mb-0" style={{ fontSize: '11px', color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>Entre na Softload V4 para acessar suas ferramentas.</p>
                    </div>

                    <form action="/login" method="POST">
                        <div className="mb-3">
                            <label htmlFor="email" className="d-block mb-1 fw-black text-uppercase"
                                   style={{ fontSize: '10px', color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>E-mail</label>
                            <div className="input-group">
                                <span className="input-group-text" style={{ background: 'rgba(15,23,42,0.7)', borderColor: 'var(--sl-bg-800)' }}>
                                    <Mail size={16} style={{ color: 'var(--sl-text-500)' }} />
                                </span>
                                <input type="email" name="email" id="email" autoComplete="email" required
                                       placeholder="seu@email.com"
                                       className="form-control"
                                       style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                            </div>
                        </div>

                        <div className="mb-3">
                            <label htmlFor="password" className="d-block mb-1 fw-black text-uppercase"
                                   style={{ fontSize: '10px', color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>Senha</label>
                            <div className="input-group">
                                <span className="input-group-text" style={{ background: 'rgba(15,23,42,0.7)', borderColor: 'var(--sl-bg-800)' }}>
                                    <Lock size={16} style={{ color: 'var(--sl-text-500)' }} />
                                </span>
                                <input type={showPwd ? 'text' : 'password'} name="password" id="password" autoComplete="current-password" required
                                       placeholder="••••••••"
                                       className="form-control"
                                       style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                                <button type="button" className="input-group-text" onClick={() => setShowPwd(v => !v)}
                                        aria-label={showPwd ? 'Ocultar senha' : 'Mostrar senha'}
                                        aria-pressed={showPwd}
                                        title={showPwd ? 'Ocultar senha' : 'Mostrar senha'}
                                        style={{ background: 'rgba(15,23,42,0.7)', borderColor: 'var(--sl-bg-800)', cursor: 'pointer' }}>
                                    {showPwd
                                        ? <EyeOff size={16} style={{ color: 'var(--sl-primary-light)' }} />
                                        : <Eye size={16} style={{ color: 'var(--sl-text-500)' }} />}
                                </button>
                            </div>
                        </div>

                        <div className="d-flex justify-content-end mb-4">
                            <a href="/recover" className="fw-bold text-uppercase text-decoration-none"
                               style={{ fontSize: '10px', color: 'var(--sl-text-500)', letterSpacing: '0.1em' }}>Esqueceu sua senha?</a>
                        </div>

                        <button type="submit" className="btn btn-sl-primary w-100 fw-black text-uppercase"
                                style={{ letterSpacing: '0.1em', height: '48px' }}>
                            Entrar na Softload
                        </button>
                    </form>

                    <div className="text-center mt-4">
                        <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>
                            Ainda não tem uma conta?{' '}
                            <a href="/register" className="fw-bold text-white text-decoration-none">Criar conta grátis</a>
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
