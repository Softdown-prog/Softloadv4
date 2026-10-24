import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

const STORAGE_KEY = 'softload_cookie_consent';
// Validade de 12 meses após aceite — renovação periódica de consentimento
// (prática usual LGPD/GDPR), evita reexibir o aviso toda semana pro mesmo
// visitante que já aceitou.
const CONSENT_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

function hasConsent() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return false;
    try {
        return Date.now() < JSON.parse(data).expiry;
    } catch {
        return false;
    }
}

export default function CookieConsent() {
    const [visible, setVisible] = useState(false);
    const [entered, setEntered] = useState(false);

    useEffect(() => {
        if (hasConsent()) return;
        const t = setTimeout(() => {
            setVisible(true);
            requestAnimationFrame(() => setEntered(true));
        }, 1500);
        return () => clearTimeout(t);
    }, []);

    function accept() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ expiry: Date.now() + CONSENT_VALIDITY_MS }));
        setEntered(false);
        setTimeout(() => setVisible(false), 400);
    }

    if (!visible) return null;

    return (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1090, width: 'min(384px, calc(100vw - 32px))' }}>
            <div className="rounded-4 p-4 shadow"
                 style={{
                     background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(20px)', border: '1px solid var(--sl-bg-800)',
                     opacity: entered ? 1 : 0, transform: entered ? 'translateY(0)' : 'translateY(12px)',
                     transition: 'opacity 0.35s ease, transform 0.35s ease',
                 }}>
                <div className="d-flex align-items-start gap-3">
                    <ShieldCheck size={20} className="mt-1 flex-shrink-0" style={{ color: 'var(--sl-primary)' }} />
                    <div className="flex-grow-1">
                        <p className="mb-2 small" style={{ color: 'var(--sl-text-300)', lineHeight: 1.6 }}>
                            Usamos um cookie essencial de sessão para manter você conectado com segurança, e armazenamento local do navegador para lembrar preferências como o tema claro/escuro. Não usamos cookies de rastreamento, publicidade ou analytics de terceiros.
                        </p>
                        <p className="mb-3 small">
                            <a href="/privacidade" className="fw-semibold" style={{ color: 'var(--sl-primary)', textDecoration: 'none' }}>Saiba mais na Política de Privacidade</a>
                        </p>
                        <div className="d-flex justify-content-end">
                            <button onClick={accept} className="btn btn-sl-primary btn-sm fw-bold text-uppercase" style={{ letterSpacing: '0.08em' }}>
                                Entendi
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
