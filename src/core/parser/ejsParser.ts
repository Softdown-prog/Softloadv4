/** API tipada dos analisadores EJS; não executa templates recebidos. */
export type CompiledEjs = (locals?: Record<string, unknown>) => string;
export type EjsParseResult =
    | { ok: true; fn: CompiledEjs }
    | { ok: false; erro: { mensagem: string } };
export type EjsAnalysisResult =
    | { ok: true; sintaxeValida: true; includesReferenciados: string[] }
    | { ok: false; erro: { mensagem: string } };

declare function require(name: string): unknown;

// ============================================================
// EJS PARSER — mesmo projeto de parsers determinísticos de
// src/core/parser/ (ver cssParser.js pro racional completo). Usa o
// pacote `ejs` já instalado no projeto (view engine do Express desde
// sempre) — `ejs.compile()` já É o parser real: monta a função de
// renderização e lança erro de sintaxe de verdade (tag `<%` sem
// fechar, `<%_`/`_%>` mal parelhado etc) sem precisar executar o
// template nem ter dados reais pra interpolar. Zero dependência nova,
// zero binding nativo.
// ============================================================

const ejs = require('ejs') as { compile(source: string, options: { filename: string; rmWhitespace: boolean }): CompiledEjs };

// ──────────────────────────────────────────────────────────────
// parseEjs — parse puro (compile, nunca executa a função resultante —
// validar sintaxe não precisa de dados reais pras variáveis do
// template). Nunca lança — EJS gerado por IA é entrada não-confiável.
// ──────────────────────────────────────────────────────────────
export function parseEjs(ejsSrc: unknown): EjsParseResult {
    if (typeof ejsSrc !== 'string' || !ejsSrc.trim()) {
        return { ok: false, erro: { mensagem: 'EJS vazio ou não é string.' } };
    }
    try {
        const fn = ejs.compile(ejsSrc, { filename: 'arquivo.ejs', rmWhitespace: false });
        return { ok: true, fn };
    } catch (e) {
        return { ok: false, erro: { mensagem: (e as Error).message } };
    }
}

const MAX_ITENS_LISTA = 30;
const INCLUDE_REGEX = /include\(\s*['"]([^'"]+)['"]/g;

// ──────────────────────────────────────────────────────────────
// analisarEjs — validade de sintaxe (parseEjs) + aviso específico do
// pipeline do Solaris: `orchestrator.js` gera um arquivo POR VEZ,
// escopo fechado (ver comentário do orquestrador) — se o EJS gerado
// chama include('outro-arquivo'), não há garantia nenhuma de que esse
// parcial existe ou vai existir no projeto final. Isso não é erro de
// sintaxe (EJS compila normalmente), mas é um risco real e específico
// deste pipeline que vale sinalizar sempre que aparecer.
// ──────────────────────────────────────────────────────────────
export function analisarEjs(ejsSrc: unknown): EjsAnalysisResult {
    const parse = parseEjs(ejsSrc);
    if (!parse.ok) return { ok: false, erro: parse.erro };

    const includesReferenciados: string[] = [];
    let m: RegExpExecArray | null;
    INCLUDE_REGEX.lastIndex = 0;
    while ((m = INCLUDE_REGEX.exec(ejsSrc as string)) !== null) {
        includesReferenciados.push(m[1]);
    }

    return {
        ok: true,
        sintaxeValida: true,
        includesReferenciados: includesReferenciados.slice(0, MAX_ITENS_LISTA),
    };
}

