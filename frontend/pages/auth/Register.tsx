import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

// Formulário nativo (method="POST" action="/register"), mesmo raciocínio do
// Login.tsx — o backend espera um POST de formulário HTML clássico, com
// redirect e rate limit próprios (src/routes/authRoutes.js).
export default function Register(): React.JSX.Element {
    const [searchParams] = useSearchParams();
    const [password, setPassword] = useState<string>('');
    const [confirm, setConfirm] = useState<string>('');

    const erro = searchParams.get('erro');

    const senhaMuitoCurta = password.length > 0 && password.length < 8;
    const senhasDivergem = confirm.length > 0 && password !== confirm;
    const valido = password.length >= 8 && password === confirm;

    return (
        <main className="d-flex align-items-center justify-content-center px-3 sl-pt-nav"
              style={{ minHeight: '100vh', background: 'var(--sl-bg-950)', position: 'relative', overflow: 'hidden' }}>

            <div style={{ position: 'absolute', top: '25%', right: '25%', width: '384px', height: '384px', background: 'rgba(14,165,233,0.07)', borderRadius: '50%', filter: 'blur(120px)', pointerEvents: 'none' }}></div>

            <div style={{ width: '100%', maxWidth: '440px', position: 'relative', zIndex: 1 }}>

                {erro && (
                    <div className="alert alert-danger fw-bold small text-center mb-4 rounded-3 d-flex align-items-center justify-content-center gap-2" role="alert">
                        <AlertTriangle size={16} /> {erro}
                    </div>
                )}

                <div className="rounded-4 p-4 p-sm-5"
                     style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(24px)', border: '1px solid var(--sl-bg-800)' }}>

                    <div className="text-center mb-4">
                        <h1 className="fw-bold text-white mb-2" style={{ letterSpacing: '-0.02em', fontSize: '1.75rem' }}>Crie sua conta grátis</h1>
                        <p className="mb-0" style={{ fontSize: '0.95rem', color: 'var(--sl-text-400)', lineHeight: 1.5 }}>Comece com o plano gratuito, sem precisar de cartão de crédito.</p>
                    </div>

                    <form action="/register" method="POST">
                        <div className="mb-3">
                            <label htmlFor="name" className="d-block mb-1 fw-semibold"
                                   style={{ fontSize: '0.875rem', color: 'var(--sl-text-300)' }}>Nome completo</label>
                            <input type="text" name="name" id="name" autoComplete="name" required
                                   placeholder="Seu nome e sobrenome"
                                   className="form-control"
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                        </div>

                        <div className="mb-3">
                            <label htmlFor="email" className="d-block mb-1 fw-semibold"
                                   style={{ fontSize: '0.875rem', color: 'var(--sl-text-300)' }}>E-mail</label>
                            <input type="email" name="email" id="email" autoComplete="email" required
                                   placeholder="seu@email.com"
                                   className="form-control"
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                        </div>

                        <div className="mb-3">
                            <label htmlFor="password" className="d-block mb-1 fw-semibold"
                                   style={{ fontSize: '0.875rem', color: 'var(--sl-text-300)' }}>Senha (mínimo de 8 caracteres)</label>
                            <input type="password" name="password" id="password" autoComplete="new-password" required minLength={8}
                                   placeholder="••••••••"
                                   className="form-control"
                                   value={password}
                                   onChange={(e) => setPassword(e.target.value)}
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                            {senhaMuitoCurta && (
                                <p className="mt-1 mb-0 small" role="status" style={{ color: '#fbbf24' }}>Use pelo menos 8 caracteres para sua senha.</p>
                            )}
                        </div>

                        <div className="mb-4">
                            <label htmlFor="confirm" className="d-block mb-1 fw-semibold"
                                   style={{ fontSize: '0.875rem', color: 'var(--sl-text-300)' }}>Confirmar senha</label>
                            {/* Sem name= de propósito — confirmação é só validação client-side,
                                o backend nunca recebe/espera este campo. */}
                            <input type="password" id="confirm" autoComplete="new-password" required
                                   placeholder="••••••••"
                                   className="form-control"
                                   value={confirm}
                                   onChange={(e) => setConfirm(e.target.value)}
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                            {senhasDivergem && (
                                <p className="mt-1 mb-0 small" role="alert" style={{ color: '#f87171' }}>As senhas não coincidem.</p>
                            )}
                        </div>

                        <p className="small mb-3" style={{ color: 'var(--sl-text-400)', lineHeight: 1.6 }}>
                            Depois do cadastro, entre com seu e-mail e senha para acessar suas ferramentas.
                        </p>
                        <button type="submit" disabled={!valido} className="btn btn-sl-primary w-100 fw-semibold"
                                style={{ letterSpacing: '0.1em', height: '48px', opacity: valido ? 1 : 0.5, cursor: valido ? 'pointer' : 'not-allowed' }}>
                            Criar minha conta
                        </button>
                    </form>

                    <p className="small text-center mt-3 mb-0" style={{ color: 'var(--sl-text-400)', lineHeight: 1.6 }}>
                        Antes de começar, consulte os nossos{' '}
                        <a href="/termos-de-uso" className="text-white">Termos de Uso</a>
                        {' '}e a{' '}
                        <a href="/privacidade" className="text-white">Política de Privacidade</a>.
                    </p>

                    <div className="text-center mt-4">
                        <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>
                            Já tem uma conta?{' '}
                            <a href="/login" className="fw-bold text-white text-decoration-none">Entrar</a>
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
