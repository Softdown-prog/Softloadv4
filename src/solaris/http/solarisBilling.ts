/** Normaliza metadados recebidos do Gemini, editor e inspeção antes da cobrança. */
import type { SolarisTokensSse } from './solarisHttpProtocol';

export interface SolarisDebitTokens { input: number; output: number }

function tokensValidos(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizarUsoTokensSolaris(value: unknown): SolarisTokensSse {
    const report: Record<string, unknown> = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    const input = tokensValidos(report.input);
    const output = tokensValidos(report.output);
    const total = tokensValidos(report.total);
    return { input, output, total: total || (Number.isSafeInteger(input + output) ? input + output : 0) };
}

/** Mantém o cálculo anterior (tokens reais ou estimativa de caracteres) para valores válidos. */
export function calcularDebitoChatSolaris(
    mensagem: string,
    resposta: string,
    uso: unknown,
    geracao: unknown = null,
): SolarisDebitTokens {
    const tokens = normalizarUsoTokensSolaris(uso);
    const extra = normalizarUsoTokensSolaris(geracao);
    return {
        input: (tokens.input > 0 ? tokens.input : Math.ceil(mensagem.length / 3.5)) + extra.input,
        output: (tokens.output > 0 ? tokens.output : Math.ceil(resposta.length / 3.5)) + extra.output,
    };
}

/** Inspeção sem contagem válida não pode originar cobrança numérica inválida. */
export function calcularDebitoInspecaoSolaris(uso: unknown): SolarisDebitTokens | null {
    const { input, output } = normalizarUsoTokensSolaris(uso);
    return input > 0 || output > 0 ? { input, output } : null;
}
