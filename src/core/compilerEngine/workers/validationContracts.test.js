'use strict';
const assert = require('node:assert/strict');
const { validarTokensCss } = require('./cssWorker');
const { validarDomIds } = require('./htmlWorker');
const { validarEscopoGlobal } = require('./jsWorker');

// Entradas opcionais/malformadas não interrompem o fluxo de validação.
assert.deepEqual(validarTokensCss(null), { ok: true, erros: [] });
assert.deepEqual(validarTokensCss(undefined), { ok: true, erros: [] });
assert.deepEqual(validarTokensCss('.a{color:var(--x, red)}'), { ok: true, erros: [] });
assert.deepEqual(validarTokensCss(':root{--x: #fff}.a{color:var(--x)}'), { ok: true, erros: [] });
assert.deepEqual(validarTokensCss('.a{color:var(--x)}', { tokensExternos: ['--x'] }), { ok: true, erros: [] });
assert.deepEqual(validarTokensCss('.a{color:var(--bs-body-bg)}'), { ok: true, erros: [] });
const orfa = validarTokensCss('.a{color:var(--x);background:var(--y)}');
assert.equal(orfa.ok, false);
assert.equal(orfa.erros.length, 2);
assert.match(orfa.erros.join(' '), /--x/);
assert.match(orfa.erros.join(' '), /--y/);

assert.deepEqual(validarDomIds(null, []), { ok: true, erros: [] });
assert.deepEqual(validarDomIds('', null), { ok: true, erros: [] });
assert.deepEqual(validarDomIds('<a id="foo"></a><b id=\'bar\'></b>', ['foo', 'bar']), { ok: true, erros: [] });
const htmlFaltando = validarDomIds('<p id="foo"></p>', ['foo','bar']);
assert.equal(htmlFaltando.ok, false);
assert.equal(htmlFaltando.erros.length, 1);
assert.match(htmlFaltando.erros[0], /#bar/);

assert.deepEqual(validarEscopoGlobal(null), { ok: true, erro: '' });
assert.deepEqual(validarEscopoGlobal([]), { ok: true, erro: '' });
assert.deepEqual(validarEscopoGlobal([null, '', ' ', undefined]), { ok: true, erro: '' });
assert.deepEqual(validarEscopoGlobal(['const alpha=1;', 'const beta=2;']), { ok: true, erro: '' });
const colisao = validarEscopoGlobal(['let identificador = 1;', 'const identificador = 2;']);
assert.equal(colisao.ok, false);
assert.match(colisao.erro, /identificador/);
const invalido = validarEscopoGlobal('function(){');
assert.equal(invalido.ok, false);

// Segurança: vm.Script apenas faz parse; o script nunca deve rodar.
const sentinel = '__sl_worker_validation_not_executed__';
delete globalThis[sentinel];
const onlyCompile = validarEscopoGlobal('globalThis.' + sentinel + ' = true;');
assert.equal(onlyCompile.ok, true);
assert.equal(globalThis[sentinel], undefined);
console.log('✅ pecaWorkers: entradas opcionais, CSS/HTML/JS e validação sem execução.');
