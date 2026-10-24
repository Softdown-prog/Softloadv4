"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJs = parseJs;
exports.analisarJs = analisarJs;
// ============================================================
// JS PARSER — Fase 2 do projeto de parsers "fora do pipeline de
// compilação" (src/core/parser/, ver cssParser.js pra Fase 1 e o
// racional completo). Usa Acorn (parser JS de verdade, AST ESTree) +
// acorn-walk (travessia), não regex nem vm.Script.
//
// Diferença de jsWorker.js: aquele usa vm.Script pra achar COLISÃO de
// escopo global entre blocos que vão concatenar no mesmo output (ex:
// dois `const x` de peças diferentes) — continua sendo o jeito certo
// de validar isso no pipeline. Este analisa UM bloco de JS arbitrário
// isolado, sem saber de outros blocos, e foca em outra classe de
// problema: identificador usado sem nunca ter sido declarado em
// lugar nenhum do próprio bloco (typo de nome de variável/função é o
// caso mais comum) — útil pra revisar JS colado num chat antes de
// aceitar.
//
// IMPORTANTE — limitação deliberada, documentada: a checagem de
// "identificador não declarado" é CONSERVADORA e usa escopo achatado
// (flat), não resolução de escopo real. Ou seja: se `x` é declarado em
// QUALQUER função do bloco, `x` usado em qualquer outra função não é
// sinalizado, mesmo que seja um escopo diferente de verdade. Isso
// evita falso-positivo (o risco caro aqui) às custas de não pegar
// bug de escopo errado (risco mais barato — o pior caso é o código
// rodar e falhar em runtime, que já é detectável de outras formas,
// não silenciosamente "quase certo" como uma var CSS órfã).
// ============================================================
const acorn = require('acorn');
const walk = require('acorn-walk');
// Globais de browser/Node comuns o bastante pra nunca contarem como
// "não declarado" — JS embutido no template roda no browser (Blogger),
// mas o projeto também tem utilitário que pode rodar em Node, então a
// lista cobre os dois ambientes. Não é exaustiva de propósito — é
// melhor a lista faltar um global raro (falso-positivo ocasional, o
// admin vê que é bobagem e ignora) do que crescer sem fim tentando
// cobrir tudo.
const GLOBAIS_CONHECIDOS = new Set([
    'window', 'document', 'console', 'navigator', 'location', 'history', 'screen',
    'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'FormData', 'Headers', 'Request', 'Response',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'alert', 'confirm', 'prompt',
    'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Function', 'Symbol', 'Proxy', 'Reflect',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
    'RegExp', 'Date', 'Intl',
    'Element', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
    'IntersectionObserver', 'MutationObserver', 'ResizeObserver',
    'Infinity', 'NaN', 'undefined', 'globalThis', 'self',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
    'this', 'arguments', 'super',
    'module', 'exports', 'require', 'process', '__dirname', '__filename',
]);
const MAX_ITENS_LISTA = 30;
// ──────────────────────────────────────────────────────────────
// parseJs — parse puro via Acorn. Nunca lança — SyntaxError do Acorn
// vira { ok:false, erro:{mensagem,linha,coluna} }.
// ──────────────────────────────────────────────────────────────
function parseJs(js) {
    if (typeof js !== 'string' || !js.trim()) {
        return { ok: false, erro: { mensagem: 'JS vazio ou não é string.', linha: null, coluna: null } };
    }
    try {
        const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowReturnOutsideFunction: true });
        return { ok: true, ast };
    }
    catch (e) {
        return { ok: false, erro: { mensagem: e.message, linha: e.loc?.line ?? null, coluna: e.loc?.column ?? null } };
    }
}
// Extrai nomes de identificador de um "padrão" de destructuring
// (ObjectPattern/ArrayPattern/AssignmentPattern/RestElement) ou de um
// Identifier simples — recursivo, nunca lança.
function _nomesDoPadrao(no, out) {
    if (!no)
        return;
    switch (no.type) {
        case 'Identifier':
            out.add(no.name);
            break;
        case 'ObjectPattern':
            for (const prop of no.properties) {
                _nomesDoPadrao(prop.type === 'RestElement' ? prop.argument : prop.value, out);
            }
            break;
        case 'ArrayPattern':
            for (const el of no.elements)
                _nomesDoPadrao(el, out);
            break;
        case 'AssignmentPattern':
            _nomesDoPadrao(no.left, out);
            break;
        case 'RestElement':
            _nomesDoPadrao(no.argument, out);
            break;
        default:
            break; // padrão não reconhecido — ignora, não derruba a análise
    }
}
// ──────────────────────────────────────────────────────────────
// analisarJs — relatório estruturado: contagem de funções/variáveis,
// identificadores possivelmente não declarados (checagem conservadora,
// ver comentário do topo), chamadas de console.* (útil pra achar
// debug esquecido antes de aceitar o código).
// ──────────────────────────────────────────────────────────────
function analisarJs(js) {
    const parse = parseJs(js);
    if (!parse.ok)
        return { ok: false, erro: parse.erro };
    const declaradas = new Set();
    const usadas = new Map(); // nome -> primeira linha
    let funcoes = 0;
    let variaveis = 0;
    const consoleLogs = [];
    walk.simple(parse.ast, {
        VariableDeclarator(no) { variaveis++; _nomesDoPadrao(no.id, declaradas); },
        FunctionDeclaration(no) {
            funcoes++;
            if (no.id)
                declaradas.add(no.id.name);
            for (const p of no.params)
                _nomesDoPadrao(p, declaradas);
        },
        FunctionExpression(no) {
            funcoes++;
            if (no.id)
                declaradas.add(no.id.name);
            for (const p of no.params)
                _nomesDoPadrao(p, declaradas);
        },
        ArrowFunctionExpression(no) {
            funcoes++;
            for (const p of no.params)
                _nomesDoPadrao(p, declaradas);
        },
        CatchClause(no) { if (no.param)
            _nomesDoPadrao(no.param, declaradas); },
        ClassDeclaration(no) { if (no.id)
            declaradas.add(no.id.name); },
        Identifier(no) {
            if (!usadas.has(no.name))
                usadas.set(no.name, no.loc?.start?.line ?? null);
        },
        CallExpression(no) {
            const callee = no.callee;
            if (callee.type === 'MemberExpression' &&
                callee.object.type === 'Identifier' && callee.object.name === 'console' &&
                callee.property.type === 'Identifier') {
                consoleLogs.push({ metodo: callee.property.name, linha: no.loc?.start?.line ?? null });
            }
        },
    });
    const identificadoresNaoDeclarados = [...usadas.keys()]
        .filter(nome => !declaradas.has(nome) && !GLOBAIS_CONHECIDOS.has(nome))
        .map(nome => ({ nome, linha: usadas.get(nome) }))
        .slice(0, MAX_ITENS_LISTA);
    return {
        ok: true,
        estrutura: { funcoes, variaveis },
        identificadoresNaoDeclarados,
        consoleLogs: consoleLogs.slice(0, MAX_ITENS_LISTA),
    };
}
