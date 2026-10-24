'use strict';

/**
 * Testes de seo.js — gerarSeoModule().
 *
 * Achado real (auditoria com template de usuário real, nik.xml): a
 * <meta name='description'> de TODO site gerado era literalmente só o
 * siteName ("Nik") — o campo `description` (resumo real do negócio,
 * capturado na conversa do chat desde a Fix 2 da auditoria "chat não usa
 * o que o usuário pediu") nunca chegava até aqui porque
 * normalizarManifesto() em compilerWorker.js não repassava o campo.
 *
 * Execute: node src/core/compilerEngine/seo.test.js
 */

const { gerarSeoModule } = require('./seo');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Com description real: usada no fallback estático (não o siteName).
{
    const xml = gerarSeoModule('Nik', 'Loja de apps e mods para celular, com curadoria diária.');
    assert('description real presente no fallback', xml.includes('Loja de apps e mods para celular'));
    assert('siteName sozinho NÃO é o fallback quando há description', !/content='Nik' name='description'/.test(xml));
    assert('data:blog.metaDescription tem prioridade (b:if)', xml.includes("cond='data:blog.metaDescription'"));
    assert('JSON-LD inclui description', xml.includes('"description": "Loja de apps e mods'));
}

// B. Sem description (retrocompatibilidade): cai pro siteName, como antes.
{
    const xml = gerarSeoModule('Nik');
    assert('sem description, fallback usa siteName', /content='Nik' name='description'/.test(xml));
    assert('JSON-LD sem campo description quando ausente', !xml.includes('"description"'));
}

// C. description é truncada a 160 chars (limite prático de SERP) e escapada.
{
    const longa = 'X'.repeat(300);
    const xml = gerarSeoModule('Site', longa);
    const m = xml.match(/content='(X+)' name='description'/);
    assert('description truncada a 160 chars no fallback', m && m[1].length === 160, m && m[1].length);
}
{
    const xml = gerarSeoModule('Site', `Loja com "aspas" & <tags> reais`);
    assert('description escapada (sem quebrar o atributo XML)', !xml.includes('content=\'Loja com "aspas"'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} seo: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
