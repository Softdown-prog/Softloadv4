'use strict';
const assert = require('node:assert/strict');
const { calcularScore } = require('./score');
const { checarAcessibilidade } = require('./acessibilidadeChecker');
const { checarResponsividade } = require('./responsividadeChecker');

assert.deepEqual(calcularScore([]), { score: 100, totalErros: 0, totalAvisos: 0 });
const categorias = [{ id: 'xml', nome: 'XML', achados: [
    { nivel: 'erro', mensagem: 'e1' }, { nivel: 'aviso', mensagem: 'a1' },
    { nivel: 'erro', mensagem: 'e2' },
]}];
assert.deepEqual(calcularScore(categorias), { score: 66, totalErros: 2, totalAvisos: 1 });
assert.deepEqual(calcularScore([{ id: 'x', nome: 'X', achados: Array.from({ length: 30 }, () => ({ nivel: 'aviso', mensagem: 'a' })) }]),
    { score: 0, totalErros: 0, totalAvisos: 30 });
assert.deepEqual(categorias[0].achados.map(a => a.mensagem), ['e1', 'a1', 'e2']);

assert.deepEqual(checarAcessibilidade("<html lang='pt'><img src='x' alt='capa'/><button aria-label='Abrir'></button></html>"), []);
assert.equal(checarAcessibilidade("<html><img src='x'/><button><span class='icon'></span></button></html>").length, 3);
assert.deepEqual(checarResponsividade("<meta name='viewport' content='width=device-width'/><style>@media screen {}</style>"), []);
assert.equal(checarResponsividade('<html></html>').length, 2);
console.log('✅ Diagnóstico TS: contratos e comportamento CommonJS preservados.');
