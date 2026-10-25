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
                        <h1 className="fw-black text-white text-uppercase mb-1" style={{ letterSpacing: '-0.03em' }}>Forjar Identidade</h1>
                        <p className="fw-bold text-uppercase mb-0" style={{ fontSize: '11px', color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>Crie o seu acesso à Fundição</p>
                    </div>

                    <form action="/register" method="POST">
                        <div className="mb-3">
                            <label htmlFor="name" className="d-block mb-1 fw-black text-uppercase"
                                   style={{ fontSize: '10px', color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>Nome do Operador</label>
                            <input type="text" name="name" id="name" autoComplete="name" required
                                   placeholder="Ex: Rodrigo Silva"
                                   className="form-control"
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                        </div>

                        <div className="mb-3">
                            <label htmlFor="email" className="d-block mb-1 fw-black text-uppercase"
                                   style={{ fontSize: '10px', color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>Identidade (E-mail)</label>
                            <input type="email" name="email" id="email" autoComplete="email" required
                                   placeholder="operador@softload.com"
                                   className="form-control"
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                        </div>

                        <div className="mb-3">
                            <label htmlFor="password" className="d-block mb-1 fw-black text-uppercase"
                                   style={{ fontSize: '10px', color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>Chave de Acesso (Mín. 8)</label>
                            <input type="password" name="password" id="password" autoComplete="new-password" required minLength={8}
                                   placeholder="••••••••"
                                   className="form-control"
                                   value={password}
                                   onChange={(e) => setPassword(e.target.value)}
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                            {senhaMuitoCurta && (
                                <p className="mt-1 fw-bold text-uppercase" style={{ fontSize: '10px', color: '#eab308' }}>A chave deve ter 8 ou mais caracteres.</p>
                            )}
                        </div>

                        <div className="mb-4">
                            <label htmlFor="confirm" className="d-block mb-1 fw-black text-uppercase"
                                   style={{ fontSize: '10px', color: 'var(--sl-text-500)', letterSpacing: '0.15em' }}>Confirmar Chave</label>
                            {/* Sem name= de propósito — confirmação é só validação client-side,
                                o backend nunca recebe/espera este campo. */}
                            <input type="password" id="confirm" autoComplete="new-password" required
                                   placeholder="••••••••"
                                   className="form-control"
                                   value={confirm}
                                   onChange={(e) => setConfirm(e.target.value)}
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                            {senhasDivergem && (
                                <p className="mt-1 fw-bold text-uppercase" style={{ fontSize: '10px', color: '#f87171' }}>As chaves não coincidem.</p>
                            )}
                        </div>

                        <button type="submit" disabled={!valido} className="btn btn-sl-primary w-100 fw-black text-uppercase"
                                style={{ letterSpacing: '0.1em', height: '48px', opacity: valido ? 1 : 0.5, cursor: valido ? 'pointer' : 'not-allowed' }}>
                            Registrar e Entrar
                        </button>
                    </form>

                    <div className="text-center mt-4">
                        <p className="small mb-0" style={{ color: 'var(--sl-text-500)' }}>
                            Já possui uma licença?{' '}
                            <a href="/login" className="fw-bold text-white text-decoration-none">Acessar Painel</a>
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
