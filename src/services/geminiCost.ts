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

export type ModeloGeminiPrecificado = 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
export interface UsoGeminiPrecificavel {
  modelo: string;
  entrada: number;
  saida: number; // incluir tokens de raciocínio; ver usageMetadata.thoughtsTokenCount
  entradaCache?: number; // subconjunto de `entrada`, não adicional
  cambioBrlPorUsd: number;
}
export interface CustoGeminiEstimado {
  modelo: ModeloGeminiPrecificado;
  entrada: number;
  saida: number;
  entradaCache: number;
  cambioBrlPorUsd: number;
  tarifaEntradaUsdPorMilhao: number;
  tarifaSaidaUsdPorMilhao: number;
  custoMicroUsd: number;
  custoMicroBrl: number;
  somenteTokensTexto: true;
}

export const TARIFAS_GEMINI_USD_POR_MILHAO: Readonly<Record<ModeloGeminiPrecificado, Readonly<{entrada: number; saida: number; cache: number}>>> = Object.freeze({
  'gemini-2.5-flash-lite': Object.freeze({entrada: 0.10, saida: 0.40, cache: 0.01}),
  'gemini-2.5-flash': Object.freeze({entrada: 0.30, saida: 2.50, cache: 0.03}),
  'gemini-2.5-pro': Object.freeze({entrada: 1.25, saida: 10.00, cache: 0.125}),
});

// Valores de estudo: NÃO ativam bloqueio no runtime ou alteram planos legados.
export const TETOS_IA_EXPERIMENTAIS_CENTAVOS = Object.freeze({
  free: 5,
  starter: 200,
  pro: 500,
  studio: 1200,
});

function inteiroNaoNegativo(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

/** Estima somente custo de tokens Standard em micro-unidades (1 unidade = 0,000001). */
export function estimarCustoGemini(uso: UsoGeminiPrecificavel): CustoGeminiEstimado | null {
  if (!uso || !Object.hasOwn(TARIFAS_GEMINI_USD_POR_MILHAO, uso.modelo)) return null;
  const { modelo, entrada, saida, entradaCache = 0, cambioBrlPorUsd } = uso;
  if (!inteiroNaoNegativo(entrada) || !inteiroNaoNegativo(saida)
      || !inteiroNaoNegativo(entradaCache) || entradaCache > entrada
      || !Number.isFinite(cambioBrlPorUsd) || cambioBrlPorUsd <= 0) return null;
  const modeloValido = modelo as ModeloGeminiPrecificado;
  const tarifa = TARIFAS_GEMINI_USD_POR_MILHAO[modeloValido];
  const proLongo = modeloValido === 'gemini-2.5-pro' && entrada > 200_000;
  const tarifaEntrada = proLongo ? 2.50 : tarifa.entrada;
  const tarifaSaida = proLongo ? 15.00 : tarifa.saida;
  const tarifaCache = proLongo ? 0.25 : tarifa.cache;
  // Preço por milhão, expresso em micro-USD: token * tarifa / 1M * 1M.
  const custoMicroUsd = Math.ceil((entrada - entradaCache) * tarifaEntrada
    + entradaCache * tarifaCache + saida * tarifaSaida);
  const custoMicroBrl = Math.ceil(custoMicroUsd * cambioBrlPorUsd);
  if (!Number.isSafeInteger(custoMicroUsd) || !Number.isSafeInteger(custoMicroBrl)) return null;
  return {
    modelo: modeloValido, entrada, saida, entradaCache, cambioBrlPorUsd,
    tarifaEntradaUsdPorMilhao: tarifaEntrada, tarifaSaidaUsdPorMilhao: tarifaSaida,
    custoMicroUsd, custoMicroBrl, somenteTokensTexto: true,
  };
}

/** Converte uso da SDK: candidatesTokenCount NÃO inclui pensamentos. */
export function extrairTokensFaturaveisGemini(usageMetadata: unknown): { entrada: number; saida: number; entradaCache: number } | null {
  if (!usageMetadata || typeof usageMetadata !== 'object' || Array.isArray(usageMetadata)) return null;
  const u = usageMetadata as Record<string, unknown>;
  const entrada = u.promptTokenCount;
  const candidatos = u.candidatesTokenCount;
  const pensamentos = u.thoughtsTokenCount ?? 0;
  const cache = u.cachedContentTokenCount ?? 0;
  if (typeof entrada !== 'number' || typeof candidatos !== 'number'
      || typeof pensamentos !== 'number' || typeof cache !== 'number'
      || !inteiroNaoNegativo(entrada) || !inteiroNaoNegativo(candidatos)
      || !inteiroNaoNegativo(pensamentos) || !inteiroNaoNegativo(cache)
      || cache > entrada || !Number.isSafeInteger(candidatos + pensamentos)) return null;
  return { entrada, saida: candidatos + pensamentos, entradaCache: cache };
}
