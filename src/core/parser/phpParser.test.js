'use strict';

/**
 * Testes do phpParser — parser PHP determinístico via php-parser (puro
 * JS, zero binding nativo).
 *
 * Execute: node src/core/parser/phpParser.test.js
 */

const { parsePhp, analisarPhp } = require('./phpParser');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── parsePhp ─────────────────────────────────────────────────────────
{
    const r = parsePhp('<?php\necho "ok";\n');
    assert('PHP válido: ok=true', r.ok === true);
    assert('PHP válido: devolve ast', !!r.ast);
}
{
    const r = parsePhp('');
    assert('PHP vazio: ok=false', r.ok === false);
}
{
    const r = parsePhp(null);
    assert('PHP não-string (null): ok=false, não lança', r.ok === false);
}
{
    const r = parsePhp('<?php\nfunction foo( {\n  return 1;\n}\n');
    assert('PHP com sintaxe quebrada: ok=false', r.ok === false);
    assert('erro de sintaxe tem linha', r.erro.linha === 2, JSON.stringify(r.erro));
}
{
    // Código PHP legítimo e comum (Solaris gera isso pra Flask/backends
    // leves em PHP) — confirma que não há falso-positivo em array/closure.
    const php = '<?php\n$itens = ["a", "b", "c"];\n$fn = function($x) { return $x * 2; };\nforeach ($itens as $i) { echo $i; }\n';
    const r = parsePhp(php);
    assert('PHP real (array/closure/foreach): ok=true', r.ok === true, r.ok ? '' : JSON.stringify(r.erro));
}

// ── analisarPhp ──────────────────────────────────────────────────────
{
    const r = analisarPhp('<?php\necho "sem fechar\n');
    assert('sintaxe inválida: ok=false', r.ok === false);
    assert('sintaxe inválida: erro presente', !!r.erro);
}
{
    const r = analisarPhp('<?php\nfunction soma($a, $b) { return $a + $b; }\nclass Produto { public $nome; }\n');
    assert('estrutura: ok=true', r.ok === true);
    assert('estrutura: função declarada detectada', r.estrutura.funcoesDeclaradas.includes('soma'), JSON.stringify(r.estrutura));
    assert('estrutura: classe declarada detectada', r.estrutura.classesDeclaradas.includes('Produto'), JSON.stringify(r.estrutura));
}
{
    const r = analisarPhp('<?php\necho "sem função nem classe";\n');
    assert('sem função/classe: listas vazias, ainda ok=true', r.ok === true && r.estrutura.funcoesDeclaradas.length === 0 && r.estrutura.classesDeclaradas.length === 0);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} phpParser: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
