"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeEntities = decodeEntities;
exports.parseExpr = parseExpr;
exports.resolvePath = resolvePath;
exports.truthy = truthy;
exports.evalNode = evalNode;
exports.stringifyValue = stringifyValue;
exports.evalCond = evalCond;
exports.evalValueExpr = evalValueExpr;
exports.evalIncludeDataAttr = evalIncludeDataAttr;
exports.resolveLoopSource = resolveLoopSource;
'use strict';
// ============================================================
// bloggerTemplateEngine.js — interpretador determinístico do
// subconjunto de templating Blogger (b:if/b:elseif/b:else, b:loop,
// b:with, b:include, b:widget/b:widget-settings, b:includable,
// b:section, data:*, expr:*) usado de fato neste projeto.
//
// Por que existe: bloggerPreviewRenderer.js (a versão anterior) era
// puramente regex/substituição de string, com uma lista pequena e
// hardcoded de condições que sabia resolver e um b:loop com só 3
// posts fictícios embutidos no próprio regex. Qualquer widget nativo
// fora desse conjunto (settings vazando como texto bruto, b:if/b:loop
// não reconhecidos ficando mal-formados) quebrava — confirmado em
// TODOS os nichos testados, migrados ou não pra esqueleto próprio
// (não é bug da migração, é estrutural, pré-existente).
//
// Levantamento (agente de auditoria, ago/2026) sobre os 19 chassis de
// `src/rag/templates/` + 13 exports reais de `exemplos/`: 1142 usos de
// `b:if` colapsam em só 124 expressões `cond` distintas; 293 `b:loop`
// em só 14 `values` distintas. É um vocabulário FECHADO — dá pra
// cobrir com um interpretador real (parser de expressão + resolução
// de caminho `data:*` contra um contexto mock) em vez de regex
// ad-hoc por caso. Isso NÃO é um motor genérico de Blogger (não busca
// dado real, não implementa a spec inteira) — é fechado ao
// vocabulário observado, com fallback tolerante (caminho desconhecido
// → string vazia, nunca vaza texto bruto de setting).
//
// Gramática de expressão suportada (cond=, values=, b:with value=,
// expr:attr=, argumentos de função) — precedência da mais baixa pra
// mais alta:
//   ternário   expr ::= elvisOuOr ('?' expr ':' expr)?
//   elvis      elvisOuOr ::= orExpr ('?:' orExpr)?
//   or/and     orExpr ::= andExpr ('or' andExpr)*  |  andExpr ('and' notExpr)*
//   not        ('not'|'!') notExpr | equality
//   igualdade  equality ::= additive (('=='|'!='|'>='|'>'|'in'|'not in') additive)?
//   soma       additive ::= primary ('+' primary)*
//   primário   path | string | number | funcCall(args) | {obj: lit} | {"set","lit"} | '(' expr ')'
// Achado real: `+` é concatenação de string OU soma numérica (typing
// dinâmico igual Blogger/JS) — usado em `"footer-" + (data:i + 1)`.
// ============================================================
// ── Tokenizer ────────────────────────────────────────────────
function decodeEntities(s) {
    return String(s)
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (c === '"' || c === "'") {
            const quote = c;
            let j = i + 1, s = '';
            while (j < n && src[j] !== quote) {
                if (src[j] === '\\' && j + 1 < n) {
                    s += src[j + 1];
                    j += 2;
                    continue;
                }
                s += src[j];
                j++;
            }
            tokens.push({ type: 'string', value: s });
            i = j + 1;
            continue;
        }
        if (src.startsWith('data:', i)) {
            let j = i + 5, s = '';
            while (j < n && /[A-Za-z0-9_.-]/.test(src[j])) {
                s += src[j];
                j++;
            }
            tokens.push({ type: 'path', value: s });
            i = j;
            continue;
        }
        if (src.startsWith('=>', i)) {
            tokens.push({ type: 'arrow' });
            i += 2;
            continue;
        }
        if (src.startsWith('?:', i)) {
            tokens.push({ type: 'elvis' });
            i += 2;
            continue;
        }
        if (src.startsWith('==', i)) {
            tokens.push({ type: 'eq' });
            i += 2;
            continue;
        }
        if (src.startsWith('!=', i)) {
            tokens.push({ type: 'neq' });
            i += 2;
            continue;
        }
        if (src.startsWith('>=', i)) {
            tokens.push({ type: 'gte' });
            i += 2;
            continue;
        }
        if (c === '>') {
            tokens.push({ type: 'gt' });
            i++;
            continue;
        }
        if (c === '!') {
            tokens.push({ type: 'bang' });
            i++;
            continue;
        }
        if (c === '?') {
            tokens.push({ type: 'question' });
            i++;
            continue;
        }
        if (c === ':') {
            tokens.push({ type: 'colon' });
            i++;
            continue;
        }
        if (c === '+') {
            tokens.push({ type: 'plus' });
            i++;
            continue;
        }
        if (c === '(') {
            tokens.push({ type: 'lparen' });
            i++;
            continue;
        }
        if (c === ')') {
            tokens.push({ type: 'rparen' });
            i++;
            continue;
        }
        if (c === '{') {
            tokens.push({ type: 'lbrace' });
            i++;
            continue;
        }
        if (c === '}') {
            tokens.push({ type: 'rbrace' });
            i++;
            continue;
        }
        if (c === ',') {
            tokens.push({ type: 'comma' });
            i++;
            continue;
        }
        if (/[0-9]/.test(c)) {
            let j = i, s = '';
            while (j < n && /[0-9.]/.test(src[j])) {
                s += src[j];
                j++;
            }
            tokens.push({ type: 'number', value: parseFloat(s) });
            i = j;
            continue;
        }
        if (/[A-Za-z_]/.test(c)) {
            let j = i, s = '';
            while (j < n && /[A-Za-z0-9_]/.test(src[j])) {
                s += src[j];
                j++;
            }
            i = j;
            const kw = s.toLowerCase();
            if (['and', 'or', 'not', 'in', 'filter', 'limit'].includes(kw))
                tokens.push({ type: kw });
            else
                tokens.push({ type: 'ident', value: s });
            continue;
        }
        i++; // caractere desconhecido — tolerante, ignora
    }
    return tokens;
}
// ── Parser (recursivo-descendente) ──────────────────────────
function parseExprTokens(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    function parseTernary() {
        const cond = parseElvis();
        if (peek() && peek().type === 'question') {
            next();
            const whenTrue = parseTernary();
            if (peek() && peek().type === 'colon')
                next();
            const whenFalse = parseTernary();
            return { type: 'ternary', cond, whenTrue, whenFalse };
        }
        return cond;
    }
    function parseElvis() {
        const left = parseOr();
        if (peek() && peek().type === 'elvis') {
            next();
            const right = parseOr();
            return { type: 'elvis', left, right };
        }
        return left;
    }
    function parseOr() {
        let left = parseAnd();
        while (peek() && peek().type === 'or') {
            next();
            left = { type: 'or', left, right: parseAnd() };
        }
        return left;
    }
    function parseAnd() {
        let left = parseNot();
        while (peek() && peek().type === 'and') {
            next();
            left = { type: 'and', left, right: parseNot() };
        }
        return left;
    }
    function parseNot() {
        if (peek() && (peek().type === 'not' || peek().type === 'bang')) {
            next();
            return { type: 'not', expr: parseNot() };
        }
        return parseEquality();
    }
    function parseEquality() {
        const left = parseAdditive();
        const t = peek();
        if (t && (t.type === 'eq' || t.type === 'neq' || t.type === 'gte' || t.type === 'gt')) {
            next();
            return { type: t.type, left, right: parseAdditive() };
        }
        if (t && t.type === 'in') {
            next();
            return { type: 'in', left, set: parseSetLiteral() };
        }
        if (t && t.type === 'not' && tokens[pos + 1] && tokens[pos + 1].type === 'in') {
            next();
            next();
            return { type: 'notin', left, set: parseSetLiteral() };
        }
        return left;
    }
    function parseAdditive() {
        let left = parsePrimary();
        while (peek() && peek().type === 'plus') {
            next();
            left = { type: 'concat', left, right: parsePrimary() };
        }
        return left;
    }
    function parseSetLiteral() {
        const items = [];
        if (peek() && peek().type === 'lbrace')
            next();
        while (peek() && peek().type !== 'rbrace') {
            items.push(parseTernary());
            if (peek() && peek().type === 'comma')
                next();
            else
                break;
        }
        if (peek() && peek().type === 'rbrace')
            next();
        return { type: 'setlit', items };
    }
    function parseObjectLiteral() {
        const entries = [];
        next(); // lbrace
        while (peek() && peek().type !== 'rbrace') {
            const key = next(); // ident
            if (peek() && peek().type === 'colon')
                next();
            const value = parseTernary();
            entries.push({ key: key && key.value, value });
            if (peek() && peek().type === 'comma')
                next();
            else
                break;
        }
        if (peek() && peek().type === 'rbrace')
            next();
        return { type: 'objlit', entries };
    }
    function parsePrimary() {
        const t = peek();
        if (!t)
            return { type: 'lit', value: undefined };
        if (t.type === 'lparen') {
            next();
            const e = parseTernary();
            if (peek() && peek().type === 'rparen')
                next();
            return e;
        }
        if (t.type === 'lbrace') {
            // Distingue objeto {chave: valor} de conjunto {"a","b"} olhando o 2º token.
            const isObj = tokens[pos + 1] && tokens[pos + 1].type === 'ident' && tokens[pos + 2] && tokens[pos + 2].type === 'colon';
            return isObj ? parseObjectLiteral() : parseSetLiteral();
        }
        if (t.type === 'path') {
            next();
            return { type: 'path', value: t.value };
        }
        if (t.type === 'string') {
            next();
            return { type: 'lit', value: t.value };
        }
        if (t.type === 'number') {
            next();
            return { type: 'lit', value: t.value };
        }
        if (t.type === 'not' || t.type === 'bang') {
            next();
            return { type: 'not', expr: parsePrimary() };
        }
        if (t.type === 'ident') {
            next();
            if (peek() && peek().type === 'lparen') {
                next();
                const args = [];
                while (peek() && peek().type !== 'rparen') {
                    args.push(parseTernary());
                    if (peek() && peek().type === 'comma')
                        next();
                    else
                        break;
                }
                if (peek() && peek().type === 'rparen')
                    next();
                return { type: 'call', name: t.value, args };
            }
            return { type: 'lit', value: t.value };
        }
        next();
        return { type: 'lit', value: undefined };
    }
    return parseTernary();
}
function parseExpr(raw) {
    return parseExprTokens(tokenize(decodeEntities(raw || '')));
}
// ── Resolução de caminho data:X.Y.Z ─────────────────────────
function resolvePath(path, ctx) {
    const segments = path.split('.');
    let cur = ctx;
    for (const seg of segments) {
        if (cur === undefined || cur === null)
            return undefined;
        if (seg === 'first') {
            cur = Array.isArray(cur) ? cur[0] : cur;
            continue;
        }
        if (Array.isArray(cur)) {
            return undefined;
        }
        if (typeof cur === 'object') {
            if (seg in cur) {
                cur = cur[seg];
                continue;
            }
            return undefined;
        }
        // valor já é primitivo (string/number/bool) mas restam segmentos
        // (ex.: sufixo .escaped/.canonical/.iso8601) — tolera, mantém o
        // valor como está em vez de tratar como erro.
        break;
    }
    return cur;
}
function truthy(v) {
    if (Array.isArray(v))
        return v.length > 0;
    if (v === undefined || v === null)
        return false;
    if (typeof v === 'string')
        return v !== '' && v !== 'false';
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'number')
        return v !== 0;
    if (typeof v === 'object')
        return Object.keys(v).length > 0;
    return !!v;
}
const RESIZE_IMAGE_POOL = [
    'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=1200&h=675',
    'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&q=80&w=1200&h=675',
    'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=1200&h=675',
];
let _resizeCallCounter = 0;
const BUILTIN_FUNCS = {
    resizeImage(args) {
        const base = args[0];
        if (typeof base === 'string' && base)
            return base;
        return RESIZE_IMAGE_POOL[_resizeCallCounter++ % RESIZE_IMAGE_POOL.length];
    },
};
function evalNode(node, ctx) {
    if (!node)
        return undefined;
    switch (node.type) {
        case 'lit': return node.value;
        case 'path': return resolvePath(node.value, ctx);
        case 'ternary': return truthy(evalNode(node.cond, ctx)) ? evalNode(node.whenTrue, ctx) : evalNode(node.whenFalse, ctx);
        case 'elvis': {
            const l = evalNode(node.left, ctx);
            return truthy(l) ? l : evalNode(node.right, ctx);
        }
        case 'or': return truthy(evalNode(node.left, ctx)) || truthy(evalNode(node.right, ctx));
        case 'and': return truthy(evalNode(node.left, ctx)) && truthy(evalNode(node.right, ctx));
        case 'not': return !truthy(evalNode(node.expr, ctx));
        case 'eq': return looseEq(evalNode(node.left, ctx), evalNode(node.right, ctx));
        case 'neq': return !looseEq(evalNode(node.left, ctx), evalNode(node.right, ctx));
        case 'gte': return toNum(evalNode(node.left, ctx)) >= toNum(evalNode(node.right, ctx));
        case 'gt': return toNum(evalNode(node.left, ctx)) > toNum(evalNode(node.right, ctx));
        case 'in': return evalSet(node.set, ctx).map(String).includes(String(evalNode(node.left, ctx)));
        case 'notin': return !evalSet(node.set, ctx).map(String).includes(String(evalNode(node.left, ctx)));
        case 'concat': {
            const l = evalNode(node.left, ctx), r = evalNode(node.right, ctx);
            if (typeof l === 'number' && typeof r === 'number')
                return l + r;
            return stringifyValue(l) + stringifyValue(r);
        }
        case 'setlit': return node.items.map(it => evalNode(it, ctx));
        case 'objlit': {
            const o = {};
            for (const e of node.entries)
                o[String(e.key)] = evalNode(e.value, ctx);
            return o;
        }
        case 'call': {
            const fn = BUILTIN_FUNCS[node.name];
            const args = node.args.map(a => evalNode(a, ctx));
            return fn ? fn(args, ctx) : undefined;
        }
        default: return undefined;
    }
}
function evalSet(node, ctx) { return node.items.map(it => evalNode(it, ctx)); }
function looseEq(a, b) { return String(a) === String(b); }
function toNum(v) { const n = parseFloat(String(v)); return Number.isNaN(n) ? 0 : n; }
function stringifyValue(v) {
    if (v === undefined || v === null)
        return '';
    if (typeof v === 'boolean')
        return v ? 'true' : 'false';
    if (Array.isArray(v))
        return v.map(stringifyValue).join(', ');
    if (typeof v === 'object')
        return '';
    return String(v);
}
function evalCond(raw, ctx) { return truthy(evalNode(parseExpr(raw), ctx)); }
function evalValueExpr(raw, ctx) { return evalNode(parseExpr(raw), ctx); }
// Achado real: o atributo `data=` de <b:include> ora é um caminho SOLTO sem
// prefixo (ex.: `data='data'` → data:data do escopo do chamador, ver
// BlogArchive1), ora é uma expressão completa com seus próprios `data:`
// internos (ex.: `data='{ image: data:image, altText: ... }'`, ver Header1
// real). Um identificador solto (sem `{`/operadores/`data:`) é sempre o
// atalho de caminho; qualquer outra coisa passa pelo avaliador de expressão
// completo (que já suporta objeto-literal).
function evalIncludeDataAttr(raw, ctx) {
    const trimmed = String(raw || '').trim();
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed) && !trimmed.startsWith('data:')) {
        return resolvePath(trimmed, ctx);
    }
    return evalValueExpr(trimmed, ctx);
}
// Resolve o `values='...'` de um <b:loop> — a única parte da gramática
// que aparece fora do corpo de `parseExpr` é o sufixo `filter (v => expr)`
// / `limit N`, que só ocorre no topo de expressões de coleção (achado B
// do levantamento: 14 formas, todas nesse formato).
function resolveLoopSource(rawValues, ctx) {
    let expr = decodeEntities(rawValues || '').trim();
    let limitN = null;
    let filterVar = null;
    let filterBody = null;
    const limitMatch = expr.match(/\blimit\s+(\d+)\s*$/i);
    if (limitMatch) {
        limitN = parseInt(limitMatch[1], 10);
        expr = expr.slice(0, limitMatch.index).trim();
    }
    const filterMatch = expr.match(/\bfilter\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*=>\s*([\s\S]+?)\)\s*$/i);
    if (filterMatch) {
        filterVar = filterMatch[1];
        filterBody = filterMatch[2];
        expr = expr.slice(0, filterMatch.index).trim();
    }
    const value = evalNode(parseExprTokens(tokenize(expr)), ctx);
    let arr = Array.isArray(value) ? value.slice() : [];
    if (filterVar && filterBody) {
        const ast = parseExprTokens(tokenize(filterBody));
        arr = arr.filter(item => truthy(evalNode(ast, Object.assign(Object.create(ctx), { [filterVar]: item }))));
    }
    if (limitN !== null)
        arr = arr.slice(0, limitN);
    return arr;
}
