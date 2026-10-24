import type { Root } from 'postcss';

/** Mantém a AST PostCSS disponível aos consumidores com um retorno discriminado. */
export interface CssParserError {
    mensagem: string;
    linha: number | null;
    coluna: number | null;
}
export type CssParseResult = { ok: true; root: Root } | { ok: false; erro: CssParserError };
export interface CssAnalysisOptions { tokensExternos?: readonly string[] }
export interface CssAnalysisReport {
    ok: true;
    sintaxeValida: true;
    estrutura: { regras: number; declaracoes: number; atRules: number };
    variaveisDeclaradas: string[];
    variaveisOrfas: { nome: string; linha: number | null }[];
    seletoresDuplicados: string[];
}
export type CssAnalysisResult = CssAnalysisReport | { ok: false; erro: CssParserError };
interface PostCssError extends Error { reason: string; line?: number; column?: number }
declare function require(name: string): unknown;
// ============================================================
// CSS PARSER — Fase 1 do projeto de parsers "fora do pipeline de
// compilação" (pasta separada, src/core/parser/), pedido explícito do
// dono do produto: ferramentas de análise de código pra manutenção
// (via Sol), distintas dos workers determinísticos do compilador
// (src/core/compilerEngine/workers/cssWorker.js).
//
// Diferença real de cssWorker.js: aquele é regex sobre string (rápido,
// suficiente pra checar 1 coisa específica — var CSS órfã — numa peça
// de dossiê já com forma conhecida). Este usa PostCSS (parser de
// verdade, AST) — pega erro de sintaxe real com linha/coluna, entende
// estrutura aninhada (@media, @supports, comentários dentro de valor)
// que regex erra fácil, e serve pra CSS ARBITRÁRIO colado num chat,
// não só peça de dossiê com forma esperada.
//
// Nunca lança pra fora — CSS de usuário/admin é entrada não-confiável,
// erro de sintaxe é resultado esperado a reportar, não uma exceção do
// programa.
// ============================================================

const postcss = require('postcss') as typeof import('postcss');

// ──────────────────────────────────────────────────────────────
// parseCss — parse puro. Retorna { ok:true, root } (Root node do
// PostCSS, pra quem precisar andar na AST direto) ou { ok:false, erro }
// com linha/coluna/mensagem do erro de sintaxe real do PostCSS.
// ──────────────────────────────────────────────────────────────
export function parseCss(css: unknown): CssParseResult {
    if (typeof css !== 'string' || !css.trim()) {
        return { ok: false, erro: { mensagem: 'CSS vazio ou não é string.', linha: null, coluna: null } };
    }
    try {
        const root = postcss.parse(css);
        return { ok: true, root };
    } catch (e) {
        if ((e as Error).name === 'CssSyntaxError') {
            return { ok: false, erro: { mensagem: (e as PostCssError).reason, linha: (e as PostCssError).line ?? null, coluna: (e as PostCssError).column ?? null } };
        }
        return { ok: false, erro: { mensagem: (e as Error).message, linha: null, coluna: null } };
    }
}

const MAX_ITENS_LISTA = 30;

// ──────────────────────────────────────────────────────────────
// analisarCss — relatório estruturado sobre um CSS arbitrário: além da
// validade de sintaxe (parseCss), varre a AST pra achar variável CSS
// órfã (usada via var() mas nunca declarada — mesmo conceito de
// cssWorker.validarTokensCss, mas via AST de verdade em vez de regex,
// então lida corretamente com @media/@supports aninhados e comentário
// dentro de bloco), seletor duplicado (mesmo seletor declarado 2+
// vezes — não é erro, mas é sinal de CSS que cresceu sem revisão) e
// contagem estrutural (regras/declarações/at-rules).
//
// `tokensExternos` (opcional, mesma forma de cssWorker) — nomes de
// variável CSS que são legítimas mesmo sem declaração LOCAL no CSS
// analisado (ex: --sl-primary, injetado globalmente pelo compilador).
// Nunca lança — retorna { ok, erro? , ...achados } sempre.
// ──────────────────────────────────────────────────────────────
export function analisarCss(css: unknown, opts: CssAnalysisOptions = {}): CssAnalysisResult {
    const parse = parseCss(css);
    if (!parse.ok) {
        return { ok: false, erro: parse.erro };
    }

    const tokensExternos = new Set(opts.tokensExternos || []);
    const declaradas = new Set<string>();
    const usadas = new Map<string, number | null>(); // nome -> primeira linha onde apareceu

    let totalRegras = 0;
    let totalDeclaracoes = 0;
    let totalAtRules = 0;
    const seletoresVistos = new Map<string, number>(); // seletor normalizado -> contagem
    const seletoresDuplicados: string[] = [];
    const varRegex = /var\(\s*(--[\w-]+)/g;

    parse.root.walkAtRules(() => { totalAtRules++; });

    parse.root.walkRules((rule) => {
        totalRegras++;
        const chave = rule.selector.trim().replace(/\s+/g, ' ');
        const contagem = (seletoresVistos.get(chave) || 0) + 1;
        seletoresVistos.set(chave, contagem);
        if (contagem === 2) seletoresDuplicados.push(chave); // registra só na 2ª vez que vê
    });

    parse.root.walkDecls((decl) => {
        totalDeclaracoes++;
        if (decl.prop.startsWith('--')) declaradas.add(decl.prop);

        let m: RegExpExecArray | null;
        varRegex.lastIndex = 0;
        while ((m = varRegex.exec(decl.value)) !== null) {
            if (!usadas.has(m[1])) usadas.set(m[1], decl.source?.start?.line ?? null);
        }
    });

    const varsOrfas = [...usadas.keys()]
        .filter(nome => !declaradas.has(nome) && !tokensExternos.has(nome))
        .map(nome => ({ nome, linha: usadas.get(nome)! }))
        .slice(0, MAX_ITENS_LISTA);

    return {
        ok: true,
        sintaxeValida: true,
        estrutura: { regras: totalRegras, declaracoes: totalDeclaracoes, atRules: totalAtRules },
        variaveisDeclaradas: [...declaradas].slice(0, MAX_ITENS_LISTA),
        variaveisOrfas: varsOrfas,
        seletoresDuplicados: seletoresDuplicados.slice(0, MAX_ITENS_LISTA),
    };
}

