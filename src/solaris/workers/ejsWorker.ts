/** Contrato utilizado pelo pipeline de validação Solaris. */
export interface SolarisWorkerResult<T = unknown> {
    ok: boolean;
    erros: string[];
    avisos: string[];
    analise?: T;
}

export interface EjsParserError { mensagem: string }
export interface EjsAnalysis {
    ok: boolean;
    erro?: string | EjsParserError | null;
    includesReferenciados?: string[];
    [field: string]: unknown;
}
declare function require(name: string): unknown;

// ============================================================
// SOLARIS EJS WORKER
// ============================================================
// Não duplica análise de EJS — reusa src/core/parser/ejsParser.js
// (analisarEjs, ejs.compile por baixo). Este Worker só normaliza a
// saída pro formato { ok, erros, avisos } que o Orquestrador espera de
// qualquer Worker (mesmo contrato de htmlWorker/cssWorker/jsWorker).
// ============================================================

const { analisarEjs } = require('../../core/parser/ejsParser') as {
    analisarEjs(code: unknown): EjsAnalysis;
};

export function validarEjs(ejsSrc: unknown): SolarisWorkerResult<EjsAnalysis> {
    const r = analisarEjs(ejsSrc);
    if (!r.ok) {
        const msg = r.erro && typeof r.erro === 'object' ? r.erro.mensagem : String(r.erro);
        return { ok: false, erros: [msg], avisos: [] };
    }

    const avisos: string[] = [];
    for (const nome of r.includesReferenciados || []) {
        avisos.push(`chama include("${nome}") — o pipeline gera um arquivo por vez, sem garantia de que esse parcial existe no projeto final. Confira manualmente.`);
    }

    return { ok: true, erros: [], avisos, analise: r };
}

