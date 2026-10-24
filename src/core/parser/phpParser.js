"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePhp = parsePhp;
exports.analisarPhp = analisarPhp;
// ============================================================
// PHP PARSER — mesmo projeto de parsers determinísticos de
// src/core/parser/ (ver cssParser.js pro racional completo). Usa
// php-parser (glayzzle/php-parser) — parser PHP de verdade, AST, puro
// JS sem binding nativo nem dependência de sistema. Deliberadamente
// NÃO shell-out pra `php -l`: a imagem de produção (Dockerfile) é
// node:18-slim sem runtime PHP instalado — checado ANTES de escolher
// essa dependência, pra nunca escrever um Worker que só funciona por
// acidente no ambiente de desenvolvimento e falha silenciosamente
// (ou com "comando não encontrado") em produção. Mesmo princípio de
// zero binding nativo já documentado no Dockerfile pros pacotes npm
// do projeto.
//
// Único objetivo desta Fase: validade de SINTAXE (o gap real
// documentado no README do Solaris — "PHP gerado funciona, mas sem
// verificação mecânica pós-geração"). Análise semântica mais profunda
// (função indefinida, variável não declarada) fica de fora por
// enquanto — engine.parseEval não resolve símbolo entre arquivos, e
// PHP gerado pelo Solaris é sempre 1 arquivo isolado por chamada
// (pipeline granular, ver orchestrator.js), então não dá pra saber se
// uma função é definida em outro arquivo do mesmo projeto sem contexto
// que o Worker não tem hoje.
// ============================================================
const { Engine } = require('php-parser');
function _criarEngine() {
    return new Engine({
        parser: { extractDoc: true, suppressErrors: false },
        ast: { withPositions: true },
    });
}
// ──────────────────────────────────────────────────────────────
// parsePhp — parse puro. Retorna { ok:true, ast } ou { ok:false, erro }
// com linha/coluna do erro de sintaxe real do php-parser. Nunca lança
// — PHP gerado por IA é entrada não-confiável, erro de sintaxe é
// resultado esperado a reportar, não uma exceção do programa.
// ──────────────────────────────────────────────────────────────
function parsePhp(php) {
    if (typeof php !== 'string' || !php.trim()) {
        return { ok: false, erro: { mensagem: 'PHP vazio ou não é string.', linha: null, coluna: null } };
    }
    try {
        const ast = _criarEngine().parseCode(php, 'arquivo.php');
        return { ok: true, ast };
    }
    catch (e) {
        return { ok: false, erro: { mensagem: e.message, linha: e.lineNumber ?? null, coluna: e.columnNumber ?? null } };
    }
}
const MAX_ITENS_LISTA = 30;
// ──────────────────────────────────────────────────────────────
// analisarPhp — relatório estruturado sobre PHP arbitrário: validade
// de sintaxe (parsePhp) + contagem estrutural leve (funções/classes
// declaradas no nível raiz) — suficiente pro pipeline saber que o
// arquivo tem substância, sem prometer análise semântica que o parser
// isolado não sustenta.
// ──────────────────────────────────────────────────────────────
function analisarPhp(php) {
    const parse = parsePhp(php);
    if (!parse.ok)
        return { ok: false, erro: parse.erro };
    const funcoesDeclaradas = [];
    const classesDeclaradas = [];
    for (const no of parse.ast.children || []) {
        if (no.kind === 'function' && no.name) {
            funcoesDeclaradas.push(typeof no.name === 'string' ? no.name : no.name.name);
        }
        else if (no.kind === 'class' && no.name) {
            classesDeclaradas.push(typeof no.name === 'string' ? no.name : no.name.name);
        }
    }
    return {
        ok: true,
        sintaxeValida: true,
        estrutura: {
            funcoesDeclaradas: funcoesDeclaradas.slice(0, MAX_ITENS_LISTA),
            classesDeclaradas: classesDeclaradas.slice(0, MAX_ITENS_LISTA),
        },
    };
}
