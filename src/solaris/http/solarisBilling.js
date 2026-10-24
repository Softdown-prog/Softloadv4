"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizarUsoTokensSolaris = normalizarUsoTokensSolaris;
exports.calcularDebitoChatSolaris = calcularDebitoChatSolaris;
exports.calcularDebitoInspecaoSolaris = calcularDebitoInspecaoSolaris;
function tokensValidos(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function normalizarUsoTokensSolaris(value) {
    const report = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value : {};
    const input = tokensValidos(report.input);
    const output = tokensValidos(report.output);
    const total = tokensValidos(report.total);
    return { input, output, total: total || (Number.isSafeInteger(input + output) ? input + output : 0) };
}
/** Mantém o cálculo anterior (tokens reais ou estimativa de caracteres) para valores válidos. */
function calcularDebitoChatSolaris(mensagem, resposta, uso, geracao = null) {
    const tokens = normalizarUsoTokensSolaris(uso);
    const extra = normalizarUsoTokensSolaris(geracao);
    return {
        input: (tokens.input > 0 ? tokens.input : Math.ceil(mensagem.length / 3.5)) + extra.input,
        output: (tokens.output > 0 ? tokens.output : Math.ceil(resposta.length / 3.5)) + extra.output,
    };
}
/** Inspeção sem contagem válida não pode originar cobrança numérica inválida. */
function calcularDebitoInspecaoSolaris(uso) {
    const { input, output } = normalizarUsoTokensSolaris(uso);
    return input > 0 || output > 0 ? { input, output } : null;
}
