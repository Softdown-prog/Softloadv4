export interface SolarisWorkerResult<T> {
    ok: boolean;
    erros: string[];
    avisos: string[];
    analise?: T;
}
declare function require(name: string): unknown;

export interface SolarisParseError { mensagem: string; linha?: number; coluna?: number }
export interface CssAnalysis {
    ok: boolean;
    erro?: string | SolarisParseError | null;
    variaveisOrfas?: { nome: string; linha?: number }[];
    seletoresDuplicados?: string[];
    [key: string]: unknown;
}
export interface SolarisCssWorkerOptions { tokensExternos?: string[] }
// ============================================================
// SOLARIS CSS WORKER (Fase 0)
// ============================================================
// Não duplica análise de CSS — reusa src/core/parser/cssParser.js
// (analisarCss, PostCSS por baixo, já determinístico e testado). Este
// Worker só normaliza a saída específica de CSS (variaveisOrfas/
// seletoresDuplicados) pro formato { ok, erros, avisos } do pipeline.
// ============================================================

const { analisarCss } = require('../../core/parser/cssParser') as { analisarCss(css: string, opts: SolarisCssWorkerOptions): CssAnalysis };

export function validarCss(css: string, opts: SolarisCssWorkerOptions = {}): SolarisWorkerResult<CssAnalysis> {
    const r = analisarCss(css, opts);
    if (!r.ok) {
        const msg = r.erro && typeof r.erro === 'object'
            ? `${r.erro.mensagem}${r.erro.linha ? ` (linha ${r.erro.linha}, col ${r.erro.coluna})` : ''}`
            : String(r.erro);
        return { ok: false, erros: [msg], avisos: [] };
    }

    const avisos: string[] = [];
    for (const v of r.variaveisOrfas || []) {
        avisos.push(`variável CSS "${v.nome}" usada mas nunca declarada${v.linha ? ` (linha ${v.linha})` : ''}.`);
    }
    for (const sel of r.seletoresDuplicados || []) {
        avisos.push(`seletor "${sel}" duplicado — a segunda ocorrência pode estar sobrescrevendo a primeira sem intenção.`);
    }

    return { ok: true, erros: [], avisos, analise: r };
}

