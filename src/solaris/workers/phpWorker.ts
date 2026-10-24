/** Contrato utilizado pelo pipeline de validação Solaris. */
export interface SolarisWorkerResult<T = unknown> {
    ok: boolean;
    erros: string[];
    avisos: string[];
    analise?: T;
}

export interface PhpParserError { mensagem: string; linha?: number; coluna?: number }
export interface PhpAnalysis {
    ok: boolean;
    erro?: string | PhpParserError | null;
    [field: string]: unknown;
}
declare function require(name: string): unknown;

// ============================================================
// SOLARIS PHP WORKER
// ============================================================
// Não duplica análise de PHP — reusa src/core/parser/phpParser.js
// (analisarPhp, php-parser por baixo, puro JS/zero binding nativo,
// funciona igual em dev e produção — ver comentário do parser sobre
// por que NÃO shell-out pra `php -l`). Este Worker só normaliza a
// saída pro formato { ok, erros, avisos } que o Orquestrador espera de
// qualquer Worker (mesmo contrato de htmlWorker/cssWorker/jsWorker).
// ============================================================

const { analisarPhp } = require('../../core/parser/phpParser') as {
    analisarPhp(code: unknown): PhpAnalysis;
};

export function validarPhp(php: unknown): SolarisWorkerResult<PhpAnalysis> {
    const r = analisarPhp(php);
    if (!r.ok) {
        const msg = r.erro && typeof r.erro === 'object'
            ? `${r.erro.mensagem}${r.erro.linha ? ` (linha ${r.erro.linha}${r.erro.coluna ? `, col ${r.erro.coluna}` : ''})` : ''}`
            : String(r.erro);
        return { ok: false, erros: [msg], avisos: [] };
    }

    return { ok: true, erros: [], avisos: [], analise: r };
}

