'use strict';

/**
 * Testes do cssParser — Fase 1 do projeto de parsers (fora do pipeline
 * de compilação, ferramenta de manutenção via Sol).
 *
 * Execute: node src/core/parser/cssParser.test.js
 */

const { parseCss, analisarCss } = require('./cssParser');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── parseCss ─────────────────────────────────────────────────────────
{
    const r = parseCss('.x { color: red; }');
    assert('CSS válido: ok=true', r.ok === true);
    assert('CSS válido: devolve root (AST)', !!r.root);
}
{
    const r = parseCss('');
    assert('CSS vazio: ok=false', r.ok === false);
}
{
    const r = parseCss(null);
    assert('CSS não-string (null): ok=false, não lança', r.ok === false);
}
{
    const r = parseCss('.x { color: red;');
    assert('CSS com chave não fechada: ok=false', r.ok === false);
    assert('erro de sintaxe tem linha', r.erro.linha === 1, JSON.stringify(r.erro));
}
{
    const r = parseCss('.x { color: ; background: }');
    // PostCSS aceita declaração com valor vazio (não é erro de parse,
    // CSS é tolerante a isso) — confirma que não falha falso-positivo.
    assert('CSS com valor vazio: ainda parseável (não é erro de sintaxe)', r.ok === true);
}

// ── analisarCss — sintaxe inválida propaga o erro ────────────────────
{
    const r = analisarCss('.x { color: red;');
    assert('sintaxe inválida: ok=false', r.ok === false);
    assert('sintaxe inválida: erro presente', !!r.erro);
}

// ── analisarCss — estrutura básica ───────────────────────────────────
{
    const r = analisarCss('.a { color: red; } .b { color: blue; } @media (min-width: 768px) { .c { color: green; } }');
    assert('estrutura: ok=true', r.ok === true);
    assert('estrutura: 3 regras (incluindo a aninhada em @media)', r.estrutura.regras === 3, JSON.stringify(r.estrutura));
    assert('estrutura: 3 declarações', r.estrutura.declaracoes === 3);
    assert('estrutura: 1 at-rule', r.estrutura.atRules === 1);
}

// ── analisarCss — variável declarada localmente, sem órfã ────────────
{
    const r = analisarCss(':root { --cor: #fff; } .x { color: var(--cor); }');
    assert('var declarada localmente: sem órfã', r.variaveisOrfas.length === 0, JSON.stringify(r.variaveisOrfas));
    assert('var declarada aparece na lista de declaradas', r.variaveisDeclaradas.includes('--cor'));
}

// ── analisarCss — variável órfã de verdade ───────────────────────────
{
    const r = analisarCss('.x { color: var(--nunca-declarada); }');
    assert('var nunca declarada: 1 órfã', r.variaveisOrfas.length === 1, JSON.stringify(r.variaveisOrfas));
    assert('var órfã tem nome certo', r.variaveisOrfas[0].nome === '--nunca-declarada');
    assert('var órfã tem número de linha', r.variaveisOrfas[0].linha === 1);
}

// ── analisarCss — tokensExternos evita falso-positivo ────────────────
{
    const r = analisarCss('.x { color: var(--sl-primary); }', { tokensExternos: ['--sl-primary'] });
    assert('var em tokensExternos: não é órfã', r.variaveisOrfas.length === 0, JSON.stringify(r.variaveisOrfas));
}

// ── analisarCss — variável usada dentro de @media aninhado ───────────
// (caso que regex ingênua pode perder dependendo do padrão usado —
// AST trata igual independente de aninhamento).
{
    const r = analisarCss(':root { --cor: #000; } @media (min-width: 768px) { .x { color: var(--cor); } .y { color: var(--outra-orfa); } }');
    assert('var declarada fora do @media, usada dentro: sem órfã pra --cor',
        !r.variaveisOrfas.some(v => v.nome === '--cor'));
    assert('var órfã dentro do @media detectada',
        r.variaveisOrfas.some(v => v.nome === '--outra-orfa'));
}

// ── analisarCss — seletor duplicado ──────────────────────────────────
{
    const r = analisarCss('.card { color: red; } .other { color: blue; } .card { background: white; }');
    assert('seletor duplicado detectado', r.seletoresDuplicados.includes('.card'), JSON.stringify(r.seletoresDuplicados));
    assert('seletor não-duplicado não aparece na lista', !r.seletoresDuplicados.includes('.other'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} cssParser: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
