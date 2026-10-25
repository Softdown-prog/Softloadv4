"use strict";
/**
 * Estimativa de custo da API Gemini, sem rede nem efeitos colaterais.
 * Valores USD por 1M de tokens (Standard, texto), consultados em 2026-10-25:
 * https://ai.google.dev/gemini-api/docs/pricing
 *
 * NÃO cobre: grounding/Google Search, áudio, imagens de saída, armazenamento
 * de cache, impostos, câmbio cobrado pelo cartão e operações de terceiros.
 * Retornar null para modelo desconhecido é intencional: nunca registrar
 * um custo zero enganoso quando um modelo é trocado por configuração.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TETOS_IA_EXPERIMENTAIS_CENTAVOS = exports.TARIFAS_GEMINI_USD_POR_MILHAO = void 0;
exports.estimarCustoGemini = estimarCustoGemini;
exports.extrairTokensFaturaveisGemini = extrairTokensFaturaveisGemini;
exports.TARIFAS_GEMINI_USD_POR_MILHAO = Object.freeze({
    'gemini-2.5-flash-lite': Object.freeze({ entrada: 0.10, saida: 0.40, cache: 0.01 }),
    'gemini-2.5-flash': Object.freeze({ entrada: 0.30, saida: 2.50, cache: 0.03 }),
    'gemini-2.5-pro': Object.freeze({ entrada: 1.25, saida: 10.00, cache: 0.125 }),
});
// Créditos V2 seguem os quantitativos anunciados nos planos do checkout.
// 1 crédito = 1 centavo do orçamento interno Gemini, ainda estimado.
// Este mapa não altera preço nem ativa enforcement por si só.
exports.TETOS_IA_EXPERIMENTAIS_CENTAVOS = Object.freeze({
    free: 5,
    starter: 500,
    pro: 2000,
    studio: 5500,
});
function inteiroNaoNegativo(n) {
    return Number.isSafeInteger(n) && n >= 0;
}
/** Estima somente custo de tokens Standard em micro-unidades (1 unidade = 0,000001). */
function estimarCustoGemini(uso) {
    if (!uso || !Object.hasOwn(exports.TARIFAS_GEMINI_USD_POR_MILHAO, uso.modelo))
        return null;
    const { modelo, entrada, saida, entradaCache = 0, cambioBrlPorUsd } = uso;
    if (!inteiroNaoNegativo(entrada) || !inteiroNaoNegativo(saida)
        || !inteiroNaoNegativo(entradaCache) || entradaCache > entrada
        || !Number.isFinite(cambioBrlPorUsd) || cambioBrlPorUsd <= 0)
        return null;
    const modeloValido = modelo;
    const tarifa = exports.TARIFAS_GEMINI_USD_POR_MILHAO[modeloValido];
    const proLongo = modeloValido === 'gemini-2.5-pro' && entrada > 200_000;
    const tarifaEntrada = proLongo ? 2.50 : tarifa.entrada;
    const tarifaSaida = proLongo ? 15.00 : tarifa.saida;
    const tarifaCache = proLongo ? 0.25 : tarifa.cache;
    // Preço por milhão, expresso em micro-USD: token * tarifa / 1M * 1M.
    const custoMicroUsd = Math.ceil((entrada - entradaCache) * tarifaEntrada
        + entradaCache * tarifaCache + saida * tarifaSaida);
    const custoMicroBrl = Math.ceil(custoMicroUsd * cambioBrlPorUsd);
    if (!Number.isSafeInteger(custoMicroUsd) || !Number.isSafeInteger(custoMicroBrl))
        return null;
    return {
        modelo: modeloValido, entrada, saida, entradaCache, cambioBrlPorUsd,
        tarifaEntradaUsdPorMilhao: tarifaEntrada, tarifaSaidaUsdPorMilhao: tarifaSaida,
        custoMicroUsd, custoMicroBrl, somenteTokensTexto: true,
    };
}
/** Converte uso da SDK: candidatesTokenCount NÃO inclui pensamentos. */
function extrairTokensFaturaveisGemini(usageMetadata) {
    if (!usageMetadata || typeof usageMetadata !== 'object' || Array.isArray(usageMetadata))
        return null;
    const u = usageMetadata;
    const entrada = u.promptTokenCount;
    const candidatos = u.candidatesTokenCount;
    const pensamentos = u.thoughtsTokenCount ?? 0;
    const cache = u.cachedContentTokenCount ?? 0;
    if (typeof entrada !== 'number' || typeof candidatos !== 'number'
        || typeof pensamentos !== 'number' || typeof cache !== 'number'
        || !inteiroNaoNegativo(entrada) || !inteiroNaoNegativo(candidatos)
        || !inteiroNaoNegativo(pensamentos) || !inteiroNaoNegativo(cache)
        || cache > entrada || !Number.isSafeInteger(candidatos + pensamentos))
        return null;
    return { entrada, saida: candidatos + pensamentos, entradaCache: cache };
}
