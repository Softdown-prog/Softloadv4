'use strict';

// O export CommonJS não pode mudar: compilerWorker e o barrel dependem dele.
// A suite completa (npm test + auditoria de nichos) verifica o XML gerado.
const assert = require('node:assert/strict');
const moduleExports = require('./compile');
const engine = require('./index');
assert.deepEqual(Object.keys(moduleExports), ['compilarTemplate']);
assert.equal(typeof moduleExports.compilarTemplate, 'function');
assert.strictEqual(engine.compilarTemplate, moduleExports.compilarTemplate);
console.log('✅ Orquestrador TypeScript preserva API CommonJS.');
