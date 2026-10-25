import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellOff, CheckCircle2, Clock3, DatabaseZap, RefreshCw, ShieldAlert } from 'lucide-react';
import {
    classificarRecuperacao,
    parseBillingRecoveryStatus,
    type BillingRecoveryStatus,
} from '../../services/billingRecovery';

const COLORS = {
    ok: '#4ade80',
    atencao: '#fbbf24',
    erro: '#f87171',
    neutro: '#94a3b8',
};

function fmt(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('pt-BR');
}
function fmtDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—'
        : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function idade(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    if (value < 60) return value + ' min';
    return Math.floor(value / 60) + ' h ' + (value % 60) + ' min';
}

export default function BillingRecoveryPanel(): React.JSX.Element {
    const [status, setStatus] = useState<BillingRecoveryStatus | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState(false);
    const requestVersion = useRef(0);

    const carregar = useCallback(async () => {
        const version = ++requestVersion.current;
        setBusy(true);
        try {
            const response = await fetch('/eu/api/billing/recuperacao', {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) throw new Error('Não foi possível consultar o monitor.');
            const payload: unknown = await response.json();
            const next = parseBillingRecoveryStatus(payload);
            if (requestVersion.current !== version) return;
            setStatus(next);
            setError(false);
        } catch (_) {
            if (requestVersion.current === version) setError(true);
        } finally {
            if (requestVersion.current === version) setBusy(false);
        }
    }, []);

    useEffect(() => {
        void carregar();
        const interval = setInterval(() => { void carregar(); }, 60000);
        return () => { clearInterval(interval); requestVersion.current++; };
    }, [carregar]);

    const indicador = classificarRecuperacao(status, error);
    const color = COLORS[indicador.gravidade];
    const possuiCiclo = !!status?.ultimaExecucaoEm;
    const rows = [
        { nome: 'Processadas no último ciclo', valor: possuiCiclo ? fmt(status?.processadas) : '—' },
        { nome: 'Falhas no último ciclo', valor: possuiCiclo ? fmt(status?.falhas) : '—' },
        { nome: 'Pendências na amostra GCS', valor: possuiCiclo ? fmt(status?.quantidadeAmostrada) : '—' },
        { nome: 'Mais antiga na amostra', valor: possuiCiclo ? idade(status?.maisAntigaMinutos) : '—' },
    ];

    return (
        <section className="section-card mb-4" aria-label="Recuperação de créditos">
            <div className="px-4 py-3 d-flex flex-wrap gap-3 align-items-center justify-content-between"
                 style={{ borderBottom: '1px solid var(--sl-bg-800)' }}>
                <div className="d-flex gap-2 align-items-center">
                    <DatabaseZap size={19} style={{ color: '#38bdf8' }} />
                    <div>
                        <p className="section-label mb-0">Recuperação de cobranças de IA</p>
                        <span style={{ color: 'var(--sl-text-500)', fontSize: '11px' }}>
                            Monitor automático a cada 5 minutos · amostra limitada do GCS
                        </span>
                    </div>
                </div>
                <button type="button" onClick={() => { void carregar(); }} disabled={busy}
                        aria-label="Atualizar monitor de cobranças"
                        className="btn btn-sm fw-bold d-inline-flex align-items-center gap-2"
                        style={{ background: 'var(--sl-bg-800)', color: 'var(--sl-text-300)', fontSize: '11px' }}>
                    <RefreshCw size={13} /> {busy ? 'Consultando…' : 'Atualizar'}
                </button>
            </div>
            <div className="px-4 py-3">
                <div role="status" aria-live="polite" className="d-flex align-items-start gap-2 mb-3">
                    {indicador.gravidade === 'ok' ? <CheckCircle2 size={19} style={{ color }} />
                        : indicador.gravidade === 'neutro' ? <Clock3 size={19} style={{ color }} />
                            : <ShieldAlert size={19} style={{ color }} />}
                    <div>
                        <p className="fw-bolder mb-0" style={{ color }}>{indicador.titulo}</p>
                        <p className="small mb-0" style={{ color: 'var(--sl-text-400)' }}>{indicador.descricao}</p>
                    </div>
                </div>
                <div className="row g-2 mb-3">
                    {rows.map(row => (
                        <div key={row.nome} className="col-6 col-xl-3">
                            <div className="h-100 p-3 rounded-3" style={{ background: 'var(--sl-bg-800)' }}>
                                <p className="fw-bolder text-white mb-1" style={{ fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums' }}>{row.valor}</p>
                                <p className="mb-0" style={{ fontSize: '11px', color: 'var(--sl-text-400)' }}>{row.nome}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="d-flex flex-wrap gap-3" style={{ color: 'var(--sl-text-400)', fontSize: '12px' }}>
                    <span><Clock3 size={13} className="me-1" /> Último ciclo: {fmtDate(status?.ultimaExecucaoEm)}</span>
                    <span>Falhas consecutivas: <strong className="text-white">{possuiCiclo ? fmt(status?.falhasConsecutivas) : '—'}</strong></span>
                    <span>Objetos ilegíveis: <strong className="text-white">{possuiCiclo ? fmt(status?.ilegivel) : '—'}</strong></span>
                    {status?.emExecucao && <span style={{ color: '#38bdf8' }}>Verificação em andamento</span>}
                </div>
                <div className="d-flex flex-wrap gap-3 mt-3" style={{ color: 'var(--sl-text-400)', fontSize: '12px' }}>
                    {status?.webhookConfigurado
                        ? <span><Bell size={13} className="me-1" /> Webhook configurado</span>
                        : <span><BellOff size={13} className="me-1" /> Alertas externos não configurados</span>}
                    {status?.erroNotificacao && (
                        <span style={{ color: '#f87171' }}><AlertTriangle size={13} className="me-1" /> Erro ao enviar última notificação</span>
                    )}
                    {status?.amostraLimitada && (
                        <span style={{ color: '#fbbf24' }}><AlertTriangle size={13} className="me-1" /> Fila maior que a amostra consultada</span>
                    )}
                    {status?.ultimoAlertaEm && <span>Último alerta: {fmtDate(status.ultimoAlertaEm)}</span>}
                </div>
                <p className="mb-0 mt-3" style={{ color: 'var(--sl-text-500)', fontSize: '10px' }}>
                    Os valores representam somente o último ciclo e uma amostra de até 26 arquivos,
                    não o total histórico de cobranças. Atualização da tela a cada 60 segundos.
                    {busy && status ? ' Atualizando dados…' : ''}
                </p>
            </div>
        </section>
    );
}
