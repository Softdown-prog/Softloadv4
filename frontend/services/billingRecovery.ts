/** Dados agregados do recuperador de cobranças. Nenhum registro individual de cliente. */
export type EstadoRecuperacao = 'nao_iniciado' | 'aguardando' | 'ok' | 'erro' | 'alerta';

export interface BillingRecoveryStatus {
    estado: EstadoRecuperacao;
    emExecucao: boolean;
    ultimaExecucaoEm: string | null;
    ultimaRecuperacaoEm: string | null;
    ultimoAlertaEm: string | null;
    processadas: number | null;
    falhas: number | null;
    quantidadeAmostrada: number | null;
    amostraLimitada: boolean;
    maisAntigaMinutos: number | null;
    ilegivel: number | null;
    falhasConsecutivas: number | null;
    alertaAtivo: boolean;
    erroNotificacao: boolean;
    webhookConfigurado: boolean;
}

export interface IndicadorRecuperacao {
    titulo: string;
    descricao: string;
    gravidade: 'ok' | 'atencao' | 'erro' | 'neutro';
}

function objectLike(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function count(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function validDate(value: unknown): string | null {
    if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) return null;
    return value;
}

/** Fail closed: dados malformados não se tornam um falso "zero pendências". */
export function parseBillingRecoveryStatus(value: unknown): BillingRecoveryStatus {
    if (!objectLike(value) || !['nao_iniciado', 'aguardando', 'ok', 'erro', 'alerta'].includes(String(value.estado))) {
        throw new Error('Resposta de monitoramento inválida.');
    }
    const estado = value.estado as EstadoRecuperacao;
    return {
        estado,
        emExecucao: value.emExecucao === true,
        ultimaExecucaoEm: validDate(value.ultimaExecucaoEm),
        ultimaRecuperacaoEm: validDate(value.ultimaRecuperacaoEm),
        ultimoAlertaEm: validDate(value.ultimoAlertaEm),
        processadas: count(value.processadas),
        falhas: count(value.falhas),
        quantidadeAmostrada: count(value.quantidadeAmostrada),
        amostraLimitada: value.amostraLimitada === true,
        maisAntigaMinutos: count(value.maisAntigaMinutos),
        ilegivel: count(value.ilegivel),
        falhasConsecutivas: count(value.falhasConsecutivas),
        alertaAtivo: value.alertaAtivo === true,
        erroNotificacao: value.erroNotificacao === true,
        webhookConfigurado: value.webhookConfigurado === true,
    };
}

export function classificarRecuperacao(
    status: BillingRecoveryStatus | null,
    erroConsulta: boolean,
    agora = Date.now(),
): IndicadorRecuperacao {
    if (!status) return erroConsulta
        ? { titulo: 'Monitor indisponível', descricao: 'Não foi possível consultar a API administrativa.', gravidade: 'erro' }
        : { titulo: 'Carregando monitor', descricao: 'Aguardando resposta da API.', gravidade: 'neutro' };
    if (erroConsulta) return { titulo: 'Consulta indisponível', descricao: 'Os dados anteriores podem estar desatualizados.', gravidade: 'erro' };
    if (status.estado === 'nao_iniciado' || status.estado === 'aguardando' || !status.ultimaExecucaoEm) {
        return { titulo: 'Aguardando primeira verificação', descricao: 'O recuperador ainda não apresentou um ciclo concluído.', gravidade: 'neutro' };
    }
    if (status.estado === 'alerta' || status.alertaAtivo) {
        return { titulo: 'Alerta de cobrança', descricao: 'Falhas ou pendências persistiram por vários ciclos.', gravidade: 'erro' };
    }
    if (status.estado === 'erro') return { titulo: 'Falha na verificação', descricao: 'A última inspeção não foi concluída.', gravidade: 'erro' };
    const elapsed = agora - Date.parse(status.ultimaExecucaoEm);
    if (!Number.isFinite(elapsed) || elapsed > 10 * 60 * 1000 || elapsed < -2 * 60 * 1000) {
        return { titulo: 'Dados desatualizados', descricao: 'O monitor não informou uma execução recente.', gravidade: 'atencao' };
    }
    if ((status.falhas ?? 0) > 0 || (status.ilegivel ?? 0) > 0 || status.amostraLimitada ||
        (status.maisAntigaMinutos ?? 0) >= 60) {
        return { titulo: 'Pendências sob observação', descricao: 'Há ocorrências recentes, ainda sem alerta persistente.', gravidade: 'atencao' };
    }
    return { titulo: 'Recuperação operacional', descricao: 'Última verificação concluída sem ocorrências na amostra.', gravidade: 'ok' };
}
