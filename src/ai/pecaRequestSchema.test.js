'use strict';

/**
 * Testes para pecaRequestSchema.js — validarPeca().
 * Execute: node src/ai/pecaRequestSchema.test.js
 */

const { validarPeca } = require('./pecaRequestSchema');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Peça válida completa.
{
    const { valido, peca, erros } = validarPeca({
        tipo: 'widget',
        domIds: ['w1', 'w1-btn'],
        css: '.w1 {}',
        html: '<div id="w1"><button id="w1-btn"></button></div>',
        js: 'const w1x = 1;',
        descricao: 'Widget de teste',
    });
    assert('peça válida: valido=true', valido === true, erros.join(' | '));
    assert('peça válida: protegida sempre false', peca.protegida === false);
    assert('peça válida: sem campo "id" (atribuído pelo orquestrador)', peca.id === undefined);
}

// B. tipo ausente/inválido invalida a peça inteira.
{
    const { valido, peca } = validarPeca({ css: '.a{}', html: '', js: '', descricao: 'x' });
    assert('sem tipo: valido=false', valido === false);
    assert('sem tipo: peca=null', peca === null);
}
{
    const { valido } = validarPeca({ tipo: 'invalido', css: '.a{}', html: '', js: '', descricao: 'x' });
    assert('tipo inválido: valido=false', valido === false);
}

// C. css/html/js todos vazios invalida a peça (nada pra persistir).
{
    const { valido } = validarPeca({ tipo: 'modulo', css: '', html: '', js: '', descricao: 'x' });
    assert('css/html/js todos vazios: valido=false', valido === false);
}

// D. modulo com só css é válido (sem html próprio).
{
    const { valido, peca, erros } = validarPeca({ tipo: 'modulo', css: '.x{color:red}', html: '', js: '', descricao: 'estiliza header' });
    assert('modulo só com css: valido=true', valido === true, erros.join(' | '));
    assert('modulo só com css: html vazio preservado', peca.html === '');
}

// E. domIds malformado é descartado com aviso, não invalida a peça.
{
    const { valido, peca, erros } = validarPeca({ tipo: 'hero', css: '', html: '<div></div>', js: '', descricao: 'x', domIds: 'não é array' });
    assert('domIds malformado: valido=true (descartado, não fatal)', valido === true);
    assert('domIds malformado: peca.domIds vira []', Array.isArray(peca.domIds) && peca.domIds.length === 0);
    assert('domIds malformado: gera aviso', erros.some(e => e.includes('domIds')), erros.join(' | '));
}

// F. Não é objeto JSON.
{
    const { valido, erros } = validarPeca('string qualquer');
    assert('não-objeto: valido=false', valido === false);
    assert('não-objeto: erro descreve o problema', erros.length > 0, erros.join(' | '));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} pecaRequestSchema: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
