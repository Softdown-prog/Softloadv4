import React, { useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Check, X, Clock, CheckCircle2 } from 'lucide-react';
import Pill from '../components/Pill';
import type { AppUser } from '../services/api';
import type { LucideIcon } from 'lucide-react';

type PlanId = 'free' | 'starter' | 'pro' | 'studio';
type PaymentStatus = 'success' | 'pending' | 'failure';

interface PlanResource {
    texto: string;
    ok: boolean;
    forte?: boolean;
}
interface Plan {
    id: PlanId;
    nome: string;
    preco: string;
    periodo: string;
    creditos: string;
    cor: string;
    destaque?: boolean;
    recursos: PlanResource[];
}
interface PaymentFeedback {
    icon: LucideIcon;
    cor: string;
    bg: string;
    titulo: string;
    texto: string;
}
interface CheckoutResponse {
    checkoutUrl?: string;
    erro?: string;
}

const PLANOS: Plan[] = [
    {
        id: 'free',
        nome: 'Gratuito',
        preco: 'R$ 0',
        periodo: 'para sempre',
        creditos: '5 créditos Gemini',
        cor: 'var(--sl-text-400)',
        recursos: [
            { texto: 'Acesso ao painel', ok: true },
            { texto: '5 créditos Gemini', ok: true },
            { texto: 'Ferramentas premium', ok: false },
            { texto: 'Workspace (geração de templates)', ok: false },
        ],
    },
    {
        id: 'starter',
        nome: 'Starter',
        preco: 'R$ 29,90',
        periodo: '/mês',
        creditos: '150 créditos Gemini / mês',
        cor: '#a78bfa',
        recursos: [
            { texto: 'Chat IA Especialista completo', ok: true },
            { texto: 'Histórico de conversas', ok: true },
            { texto: '100 MB armazenamento', ok: true },
            { texto: 'Workspace (geração de templates)', ok: false },
        ],
    },
    {
        id: 'pro',
        nome: 'Pro',
        preco: 'R$ 39,90',
        periodo: '/mês',
        creditos: '600 créditos Gemini / mês',
        cor: 'var(--sl-primary)',
        recursos: [
            { texto: 'Chat IA Especialista completo', ok: true },
            { texto: 'Histórico de conversas', ok: true },
            { texto: '100 MB armazenamento', ok: true },
            { texto: 'Workspace (geração de templates)', ok: false },
        ],
    },
    {
        id: 'studio',
        nome: 'Studio',
        preco: 'R$ 59,90',
        periodo: '/mês',
        creditos: '1.200 créditos Gemini / mês',
        cor: 'var(--sl-primary)',
        destaque: true,
        recursos: [
            { texto: 'Tudo do Pro', ok: true },
            { texto: 'Workspace — geração e compilação de templates', ok: true, forte: true },
            { texto: '500 MB armazenamento', ok: true },
            { texto: 'Suporte prioritário', ok: true },
        ],
    },
];

const STATUS_FEEDBACK: Record<PaymentStatus, PaymentFeedback> = {
    success: {
        icon: CheckCircle2,
        cor: '#4ade80',
        bg: 'rgba(34,197,94,0.08)',
        titulo: 'Pagamento recebido! Ativando seu plano...',
        texto: 'Será ativado em instantes.',
    },
    pending: {
        icon: Clock,
        cor: '#facc15',
        bg: 'rgba(234,179,8,0.08)',
        titulo: 'Pagamento em processamento.',
        texto: 'Pix/boleto pode levar alguns minutos. Você receberá acesso assim que confirmado.',
    },
    failure: {
        icon: X,
        cor: '#f87171',
        bg: 'rgba(239,68,68,0.08)',
        titulo: 'Pagamento não finalizado.',
        texto: 'Ocorreu um erro ou foi cancelado. Tente novamente abaixo.',
    },
};

export default function Upgrade(): React.JSX.Element {
    const { user } = useOutletContext<{ user: AppUser }>();
    const [searchParams] = useSearchParams();
    const [carregandoPlano, setCarregandoPlano] = useState<PlanId | null>(null);
    const [erro, setErro] = useState('');

    const planoAtual = user?.is_active ? (user?.plano || 'pro') : 'free';
    const status = searchParams.get('status');
    const feedback = status && Object.prototype.hasOwnProperty.call(STATUS_FEEDBACK, status)
        ? STATUS_FEEDBACK[status as PaymentStatus]
        : null;

    async function selecionarPlano(planoId: PlanId): Promise<void> {
        setErro('');
        setCarregandoPlano(planoId);
        try {
            const res = await fetch('/dashboard/checkout-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plano: planoId }),
            });
            const data = await res.json().catch(() => ({})) as CheckoutResponse;
            if (data.checkoutUrl) {
                window.location.href = data.checkoutUrl;
                return;
            }
            throw new Error(data.erro || 'Erro ao gerar link de pagamento. Tente novamente.');
        } catch (e) {
            setErro(e instanceof Error ? e.message : 'Não foi possível conectar ao servidor. Tente novamente.');
        } finally {
            setCarregandoPlano(null);
        }
    }

    return (
        <div className="sl-dashboard-page p-3 p-md-5" style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div className="sl-dashboard-page-header text-center mb-5">
                <Pill tone="primary" size="sm" uppercase={false} className="mb-2 font-monospace">UPGRADE DE CONTA</Pill>
                <h1 className="fw-bolder text-uppercase mb-2" style={{ fontSize: '1.8rem', letterSpacing: '-0.03em', fontWeight: 900 }}>
                    Escolha seu Plano
                </h1>
                <p className="small text-secondary" style={{ maxWidth: '500px', margin: '0 auto' }}>
                    Créditos de IA renovados mensalmente. Sem fidelidade — cancele quando quiser.
                </p>
            </div>

            {feedback && (
                <div className="rounded-3 p-3 mb-4 d-flex align-items-start gap-3" style={{ background: feedback.bg, color: feedback.cor, border: `1px solid ${feedback.cor}40` }}>
                    <feedback.icon size={18} className="flex-shrink-0 mt-1" />
                    <div>
                        <p className="fw-bold mb-1">{feedback.titulo}</p>
                        <p className="mb-0 small" style={{ opacity: .85 }}>{feedback.texto}</p>
                    </div>
                </div>
            )}

            {erro && (
                <div className="alert alert-danger py-2 px-3 small mb-4" role="alert">{erro}</div>
            )}

            <div className="row g-4 justify-content-center">
                {PLANOS.map(plano => {
                    const isAtual = plano.id === planoAtual;
                    return (
                        <div key={plano.id} className="col-12 col-sm-6 col-lg-3">
                            <div
                                className={`sl-card sl-dashboard-plan-card ${plano.destaque ? 'sl-dashboard-plan-card--featured' : ''} h-100 d-flex flex-column mb-0 position-relative overflow-hidden`}
                                style={plano.destaque ? { border: '2px solid var(--sl-primary)', background: 'linear-gradient(135deg, rgba(14,165,233,0.05), rgba(37,99,235,0.05))' } : undefined}
                            >
                                {plano.destaque && (
                                    <div className="position-absolute top-0 end-0 bg-primary text-white font-monospace px-3 py-1 fw-bold text-uppercase" style={{ fontSize: '9px', borderBottomLeftRadius: '8px' }}>
                                        Mais Popular
                                    </div>
                                )}
                                <div className="mb-4">
                                    <span className="fw-bolder text-uppercase font-monospace d-block mb-1" style={{ fontSize: '9px', letterSpacing: '0.2em', color: plano.cor }}>{plano.nome}</span>
                                    <h2 className="fw-black mb-0">{plano.preco} <span className="small text-secondary fw-normal">{plano.periodo}</span></h2>
                                    <p className="small mb-0 font-monospace mt-1" style={{ fontSize: '0.7rem', color: 'var(--sl-text-400)' }}>{plano.creditos}</p>
                                </div>
                                <ul className="list-unstyled d-flex flex-column gap-2 mb-4 small flex-grow-1">
                                    {plano.recursos.map((r, i) => (
                                        <li key={i} className="d-flex align-items-center gap-2" style={{ color: r.ok ? 'var(--bs-body-color)' : 'var(--sl-text-500)', opacity: r.ok ? 1 : .6 }}>
                                            {r.ok ? <Check size={15} className="flex-shrink-0" style={{ color: plano.cor }} /> : <X size={15} className="flex-shrink-0" style={{ color: 'var(--sl-text-500)' }} />}
                                            <span className={r.forte ? 'fw-bold' : ''}>{r.texto}</span>
                                        </li>
                                    ))}
                                </ul>
                                {plano.id === 'free' ? (
                                    <button className="btn btn-outline-secondary w-100 fw-bold" disabled>
                                        {isAtual ? 'Plano Atual' : 'Gratuito'}
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-sl-primary w-100 fw-bold"
                                        disabled={isAtual || carregandoPlano === plano.id}
                                        onClick={() => selecionarPlano(plano.id)}
                                    >
                                        {isAtual ? 'Plano Ativo' : carregandoPlano === plano.id ? 'Aguarde...' : `Assinar ${plano.nome}`}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <p className="text-center small text-secondary mt-5 mb-0">
                Créditos não utilizados expiram ao final do ciclo de 30 dias e são renovados com o próximo pagamento.
            </p>
        </div>
    );
}
