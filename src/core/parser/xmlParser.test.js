'use strict';

/**
 * Testes do xmlParser — Fase 2 do projeto de parsers.
 * Execute: node src/core/parser/xmlParser.test.js
 */

const { parseXml, analisarXml } = require('./xmlParser');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── parseXml ─────────────────────────────────────────────────────────
{
    const r = parseXml('<a><b>oi</b></a>');
    assert('XML válido: ok=true', r.ok === true);
    assert('XML válido: devolve arvore', !!r.arvore);
}
{
    const r = parseXml('');
    assert('XML vazio: ok=false', r.ok === false);
}
{
    const r = parseXml(null);
    assert('XML não-string: ok=false, não lança', r.ok === false);
}
{
    const r = parseXml('<a><b>oi</a>');
    assert('XML com tag não fechada corretamente: ok=false', r.ok === false);
    assert('erro de sintaxe tem linha', r.erro.linha === 1, JSON.stringify(r.erro));
}

// ── analisarXml — estrutura básica ──────────────────────────────────
{
    const r = analisarXml('<root><item>a</item><item>b</item><other/></root>');
    assert('estrutura: ok=true', r.ok === true);
    assert('estrutura: contagem de tags correta', r.estrutura.tags.item === 2 && r.estrutura.tags.other === 1 && r.estrutura.tags.root === 1, JSON.stringify(r.estrutura));
}

// ── analisarXml — sem id duplicado ──────────────────────────────────
{
    const r = analisarXml('<root><a id="1"/><b id="2"/></root>');
    assert('sem id duplicado: lista vazia', r.idsDuplicados.length === 0, JSON.stringify(r.idsDuplicados));
}

// ── analisarXml — id duplicado detectado ────────────────────────────
{
    const r = analisarXml('<root><a id="dup"/><b id="dup"/></root>');
    assert('id duplicado detectado', r.idsDuplicados.some(d => d.id === 'dup'), JSON.stringify(r.idsDuplicados));
}
{
    // Mesmo achado, mas com id repetido em tags de nomes diferentes, em
    // níveis de aninhamento diferentes — confirma que a checagem é
    // sobre o documento inteiro, não só irmãos diretos.
    const r = analisarXml('<root><section><widget id="w1"/></section><footer id="w1"/></root>');
    assert('id duplicado detectado entre níveis de aninhamento diferentes', r.idsDuplicados.some(d => d.id === 'w1'), JSON.stringify(r.idsDuplicados));
}

// ── analisarXml — XML sem nenhum atributo id não quebra ─────────────
{
    const r = analisarXml('<root><a>sem id nenhum</a></root>');
    assert('sem atributo id em lugar nenhum: ok=true, lista vazia', r.ok === true && r.idsDuplicados.length === 0);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} xmlParser: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
