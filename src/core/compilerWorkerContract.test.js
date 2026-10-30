require('./test/isolatedTelemetry.cjs');
'use strict';
const assert = require('node:assert/strict');
const worker = require('./compilerWorker');
const input = require('./workerInput');
const xml = require('./workerXmlValidation');
const chassis = require('./workerChassis');
const design = require('./workerDesignPackage');

assert.deepEqual(Object.keys(worker), [
    'executarCompilacao',
    'validarManifesto',
    'validarXmlSaida',
    'carregarChassisParaNicho',
    'verificarMarcadoresDesignPackage',
], 'API CommonJS mantém as cinco chaves e a ordem de produção');
assert.strictEqual(worker.validarManifesto, input.validarManifesto);
assert.strictEqual(worker.validarXmlSaida, xml.validarXmlSaida);
assert.strictEqual(worker.verificarMarcadoresDesignPackage, design.verificarMarcadoresDesignPackage);
assert.equal(typeof worker.executarCompilacao, 'function');
assert.equal(typeof worker.carregarChassisParaNicho, 'function');
assert.deepEqual(worker.validarManifesto(null), ['Corpo da requisição não é um objeto JSON válido.']);
assert.ok(worker.validarManifesto({siteName: 'a'}).some(item => item.includes('mínimo 2 caracteres')));
assert.deepEqual(worker.validarManifesto({siteName:'Loja do Teste', modules:{}}), []);
assert.ok(worker.validarXmlSaida('não é XML').some(item => item.includes('Estrutura <html>')));
const check = worker.verificarMarcadoresDesignPackage('<html/>');
assert.equal(typeof check.ok, 'boolean');
assert.ok(Array.isArray(check.erros));
assert.throws(() => worker.executarCompilacao({siteName:'a'}), /\[MANIFEST\]/);
assert.throws(() => worker.executarCompilacao(null), /\[MANIFEST\]/);
console.log('✅ compilerWorker: exports CommonJS, validação, diagnóstico e falhas do manifesto.');
