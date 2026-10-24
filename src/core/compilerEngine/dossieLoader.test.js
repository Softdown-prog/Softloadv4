'use strict';
const assert = require('node:assert/strict');
const {parsearDossie,carregarNichoDossie,limparCache} = require('./dossieLoader');

assert.throws(()=>parsearDossie('{invalido', 'saas-nexus'),/JSON inválido/);
assert.throws(()=>parsearDossie(JSON.stringify({nicho:'outro',pecas:[],tokensCss:{}}),'saas-nexus'),/contrato inválido/);
assert.throws(()=>parsearDossie(JSON.stringify({nicho:'saas-nexus',pecas:'corrompido',tokensCss:{}}),'saas-nexus'),/contrato inválido/);

const parsed=parsearDossie(JSON.stringify({nicho:'saas-nexus',pecas:[],tokensCss:{light_mode:{}}}),'saas-nexus');
assert.equal(parsed.nicho,'saas-nexus');

limparCache();
const existente=carregarNichoDossie('saas-nexus');
assert.ok(existente && existente.nicho==='saas-nexus' && Array.isArray(existente.pecas));
assert.equal(carregarNichoDossie('sem-dossie-ficticio-xyz'),null,'somente ausente pode retornar null');

console.log('OK dossieLoader: invalido nao cai em fallback, ausente segue valido');
