'use strict';

/**
 * Monitor de recuperação de cobrança. Retém apenas contadores agregados:
 * não registra email, prompts, IDs de clientes ou conteúdo dos recibos.
 * Uma instância por processo é suficiente; múltiplas VPS podem enviar
 * alertas redundantes, mas os débitos continuam idempotentes no Firestore.
 */
let monitorAtivo = null;

function criarMonitorRecuperacaoCobrancas({
    recuperar, inspecionar, notificar = async () => {},
    agora = () => Date.now(), limiarCiclos = 3,
    intervaloAlertaMs = 60 * 60 * 1000,
} = {}) {
    if (typeof recuperar !== 'function' || typeof inspecionar !== 'function') {
        throw new TypeError('Recuperador e inspeção de pendências são obrigatórios.');
    }
    let emExecucao = false;
    let falhasConsecutivas = 0;
    let alertaAtivo = false;
    let ultimaNotificacaoMs = 0;
    let resultado = {
        estado: 'aguardando',
        ultimaExecucaoEm: null,
        ultimaRecuperacaoEm: null,
        processadas: 0,
        falhas: 0,
        conflitosCursor: 0,
        quantidadeAmostrada: 0,
        amostraLimitada: false,
        maisAntigaMinutos: null,
        ilegivel: 0,
        falhasConsecutivas: 0,
        alertaAtivo: false,
        ultimoAlertaEm: null,
        erroNotificacao: false,
    };
    function estado() { return { ...resultado, emExecucao }; }

    async function avisar(tipo, motivos, timestamp) {
        const mensagem = {
            tipo,
            motivos,
            falhasConsecutivas,
            processadas: resultado.processadas,
            falhas: resultado.falhas,
            pendenciasAmostradas: resultado.quantidadeAmostrada,
            amostraLimitada: resultado.amostraLimitada,
            maisAntigaMinutos: resultado.maisAntigaMinutos,
            ts: new Date(timestamp).toISOString(),
        };
        try {
            await notificar(mensagem);
            ultimaNotificacaoMs = timestamp;
            resultado.ultimoAlertaEm = mensagem.ts;
            resultado.erroNotificacao = false;
        } catch (err) {
            resultado.erroNotificacao = true;
            console.error('[BILLING-ALERT] Falha ao emitir notificação:', err instanceof Error ? err.message : 'Erro desconhecido');
        }
    }

    async function executar() {
        if (emExecucao) return estado();
        emExecucao = true;
        const timestamp = agora();
        let motivos = [];
        try {
            const recuperacao = await recuperar();
            // A inspeção acontece depois do débito para não alertar por
            // registros já processados neste ciclo.
            const fila = await inspecionar();
            const processadas = Math.max(0, Number(recuperacao?.processadas) || 0);
            const falhas = Math.max(0, Number(recuperacao?.falhas) || 0);
            const conflitosCursor = Math.max(0, Number(recuperacao?.conflitosCursor) || 0);
            const amostradas = Math.max(0, Number(fila?.quantidadeAmostrada) || 0);
            const idade = Number(fila?.maisAntigaMs);
            const maisAntigaMinutos = fila?.maisAntigaMs != null && Number.isFinite(idade) && idade >= 0 ? Math.floor(idade / 60000) : null;
            const ilegivel = Math.max(0, Number(fila?.ilegivel) || 0);
            resultado = {
                ...resultado, estado: 'ok',
                ultimaExecucaoEm: new Date(timestamp).toISOString(),
                ultimaRecuperacaoEm: new Date(timestamp).toISOString(),
                processadas, falhas, conflitosCursor, quantidadeAmostrada: amostradas,
                amostraLimitada: !!fila?.amostraLimitada, maisAntigaMinutos,
                ilegivel,
            };
            if (falhas > 0) motivos.push('debito_falhou');
            if (ilegivel > 0) motivos.push('pendencia_ilegivel');
            if (fila?.amostraLimitada) motivos.push('fila_acima_do_limite');
            if (maisAntigaMinutos !== null && maisAntigaMinutos >= 60) motivos.push('pendencia_antiga');
        } catch (err) {
            motivos = ['verificacao_indisponivel'];
            resultado = {
                ...resultado, estado: 'erro',
                ultimaExecucaoEm: new Date(timestamp).toISOString(),
                falhas: Math.max(1, resultado.falhas),
            };
            console.error('[BILLING-RECOVERY] Falha no ciclo:', err instanceof Error ? err.message : 'Erro desconhecido');
        }
        falhasConsecutivas = motivos.length ? falhasConsecutivas + 1 : 0;
        resultado.falhasConsecutivas = falhasConsecutivas;
        if (motivos.length && falhasConsecutivas >= limiarCiclos) {
            const deveAvisar = !alertaAtivo || ultimaNotificacaoMs === 0 || timestamp - ultimaNotificacaoMs >= intervaloAlertaMs;
            alertaAtivo = true;
            resultado.alertaAtivo = true;
            resultado.estado = 'alerta';
            if (deveAvisar) await avisar('cobrancas_pendentes', motivos, timestamp);
        } else if (!motivos.length) {
            const estavaEmAlerta = alertaAtivo;
            alertaAtivo = false;
            resultado.alertaAtivo = false;
            if (estavaEmAlerta) await avisar('cobrancas_normalizadas', [], timestamp);
        } else if (alertaAtivo) {
            resultado.alertaAtivo = true;
            resultado.estado = 'alerta';
        }
        emExecucao = false;
        return estado();
    }

    const monitor = { executar, estado };
    return monitor;
}

function definirMonitorRecuperacaoCobrancas(monitor) { monitorAtivo = monitor; }
function obterStatusRecuperacaoCobrancas() {
    return monitorAtivo?.estado() ?? { estado: 'nao_iniciado', emExecucao: false };
}

module.exports = {
    criarMonitorRecuperacaoCobrancas,
    definirMonitorRecuperacaoCobrancas,
    obterStatusRecuperacaoCobrancas,
};
