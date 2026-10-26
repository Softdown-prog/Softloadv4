import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Info, AlertTriangle, CheckCircle2, ArrowLeft } from 'lucide-react';

// Formulário nativo (method="POST" action="/recover") — o backend sempre
// redireciona pra /recover?sucesso=... (mesmo se o e-mail não existir, por
// design anti-enumeração — ver src/routes/authRoutes.js).
export default function Recover(): React.JSX.Element {
    const [searchParams] = useSearchParams();

    const erro = searchParams.get('erro');
    const sucesso = searchParams.get('sucesso');

    return (
        <main className="d-flex align-items-center justify-content-center px-3 sl-pt-nav"
              style={{ minHeight: '100vh', background: 'var(--sl-bg-900)', position: 'relative', overflow: 'hidden' }}>

            <div style={{ position: 'absolute', top: '25%', left: '25%', width: '384px', height: '384px', background: 'rgba(14,165,233,0.07)', borderRadius: '50%', filter: 'blur(120px)', pointerEvents: 'none' }}></div>

            <div style={{ width: '100%', maxWidth: '440px', position: 'relative', zIndex: 1 }}>

                {erro && (
                    <div className="alert alert-danger fw-bold small text-center mb-4 rounded-3 d-flex align-items-center justify-content-center gap-2" role="alert">
                        <AlertTriangle size={16} /> {erro}
                    </div>
                )}

                {sucesso && (
                    <div className="alert alert-success fw-bold small text-center mb-4 rounded-3 d-flex align-items-center justify-content-center gap-2" role="alert">
                        <CheckCircle2 size={16} /> {sucesso}
                    </div>
                )}

                <div className="rounded-4 p-4 p-sm-5"
                     style={{ background: 'rgba(30,41,59,0.4)', backdropFilter: 'blur(24px)', border: '1px solid rgba(51,65,85,0.5)' }}>

                    <div className="text-center mb-4">
                        <div className="d-flex align-items-center justify-content-center mx-auto mb-3 rounded-circle"
                             style={{ width: '64px', height: '64px', background: 'var(--sl-bg-900)', border: '1px solid var(--sl-bg-800)' }}>
                            <KeyRound size={24} style={{ color: 'var(--sl-primary-light)' }} />
                        </div>
                        <h1 className="fw-black text-white text-uppercase mb-0" style={{ letterSpacing: '-0.03em' }}>Recuperar senha</h1>
                    </div>

                    <p className="small text-center mb-4" style={{ color: 'var(--sl-text-400)', lineHeight: 1.6 }}>
                        Informe seu e-mail para receber as instruções de redefinição de senha.
                    </p>

                    <form action="/recover" method="POST">
                        <div className="mb-4">
                            <label htmlFor="recover-email" className="d-block mb-1 fw-bold text-uppercase"
                                   style={{ fontSize: '11px', color: 'var(--sl-text-500)', letterSpacing: '0.12em' }}>E-mail da conta</label>
                            <input id="recover-email" type="email" name="email" autoComplete="email" placeholder="seu@email.com" required
                                   className="form-control"
                                   style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'var(--sl-bg-800)', color: '#fff' }} />
                        </div>

                        <button type="submit" className="btn btn-sl-primary w-100 fw-black text-uppercase mb-4"
                                style={{ letterSpacing: '0.1em', height: '48px' }}>
                            Enviar link de recuperação
                        </button>
                    </form>

                    <div className="rounded-3 p-3 mb-4" style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.3)' }}>
                        <h3 className="fw-black text-uppercase mb-3 d-flex align-items-center gap-2"
                            style={{ fontSize: '10px', color: 'var(--sl-primary)', letterSpacing: '0.25em' }}>
                            <Info size={13} /> Como recuperar sua senha
                        </h3>
                        <div className="d-flex flex-column gap-3">
                            <div className="d-flex align-items-start gap-3">
                                <span className="font-monospace fw-bold flex-shrink-0" style={{ fontSize: '11px', color: 'var(--sl-primary-light)', marginTop: '1px' }}>01.</span>
                                <p className="mb-0" style={{ fontSize: '11px', color: 'var(--sl-text-400)', lineHeight: 1.6 }}>Se o endereço estiver cadastrado, verifique a <strong>caixa de entrada</strong> e a pasta de <strong>spam</strong>.</p>
                            </div>
                            <div className="d-flex align-items-start gap-3">
                                <span className="font-monospace fw-bold flex-shrink-0" style={{ fontSize: '11px', color: 'var(--sl-primary-light)', marginTop: '1px' }}>02.</span>
                                <p className="mb-0" style={{ fontSize: '11px', color: 'var(--sl-text-400)', lineHeight: 1.6 }}>Abra o link enviado pela <strong>Softload</strong> para definir uma nova senha.</p>
                            </div>
                            <div className="d-flex align-items-start gap-3">
                                <span className="font-monospace fw-bold flex-shrink-0" style={{ fontSize: '11px', color: 'var(--sl-primary-light)', marginTop: '1px' }}>03.</span>
                                <p className="mb-0" style={{ fontSize: '11px', color: 'var(--sl-text-400)', lineHeight: 1.6 }}>O link de recuperação é temporário. Se expirar, solicite um novo nesta página.</p>
                            </div>
                        </div>
                    </div>

                    <div className="text-center pt-3" style={{ borderTop: '1px solid rgba(51,65,85,0.5)' }}>
                        <a href="/login" className="fw-bold text-decoration-none d-inline-flex align-items-center gap-1" style={{ fontSize: '0.875rem', color: 'var(--sl-text-400)' }}>
                            <ArrowLeft size={14} /> Voltar para entrar
                        </a>
                    </div>
                </div>
            </div>
        </main>
    );
}
