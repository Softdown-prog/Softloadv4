'use strict';

/**
 * Testes do ejsParser — usa o pacote `ejs` já instalado (ejs.compile
 * como parser real, nunca executa a função resultante).
 *
 * Execute: node src/core/parser/ejsParser.test.js
 */

const { parseEjs, analisarEjs } = require('./ejsParser');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── parseEjs ─────────────────────────────────────────────────────────
{
    const r = parseEjs('<h1><%= titulo %></h1>');
    assert('EJS válido: ok=true', r.ok === true);
    assert('EJS válido: devolve fn compilada', typeof r.fn === 'function');
}
{
    const r = parseEjs('');
    assert('EJS vazio: ok=false', r.ok === false);
}
{
    const r = parseEjs(undefined);
    assert('EJS não-string (undefined): ok=false, não lança', r.ok === false);
}
{
    const r = parseEjs('<h1><%= titulo %');
    assert('tag EJS não fechada: ok=false', r.ok === false);
    assert('erro tem mensagem', typeof r.erro.mensagem === 'string' && r.erro.mensagem.length > 0);
}
{
    // Compilar não deve exigir que as variáveis do template já existam —
    // validar sintaxe é diferente de executar o template com dados reais.
    const r = parseEjs('<% if (usuario.logado) { %><p><%= usuario.nome %></p><% } %>');
    assert('EJS com variáveis não-definidas ainda compila (não executa)', r.ok === true);
}

// ── analisarEjs ──────────────────────────────────────────────────────
{
    const r = analisarEjs('<h1><%= titulo %');
    assert('sintaxe inválida: ok=false', r.ok === false);
}
{
    const r = analisarEjs('<h1>Título estático, sem tag EJS nenhuma</h1>');
    assert('sem include: lista vazia', r.ok === true && r.includesReferenciados.length === 0);
}
{
    const r = analisarEjs("<%- include('partials/header') %><h1>Oi</h1><%- include(\"partials/footer\") %>");
    assert('detecta includes (aspas simples e duplas)', r.ok === true && r.includesReferenciados.length === 2, JSON.stringify(r.includesReferenciados));
    assert('nomes dos includes corretos', r.includesReferenciados.includes('partials/header') && r.includesReferenciados.includes('partials/footer'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ejsParser: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
