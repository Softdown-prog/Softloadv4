'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCli(filename, modules, args = []) {
  const output = { logs: [], errors: [], exits: [] };
  const context = {
    exports: {}, module: { exports: {} },
    require(id) {
      if (!Object.prototype.hasOwnProperty.call(modules, id)) {
        throw new Error('Unexpected CLI require: ' + id);
      }
      return modules[id];
    },
    process: { argv: ['node', filename, ...args], exit: code => output.exits.push(code) },
    console: {
      log: (...args) => output.logs.push(args.join(' ')),
      error: (...args) => output.errors.push(args.join(' ')),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, filename), 'utf8'), context, {
    filename, timeout: 2000,
  });
  return output;
}

test('sweep gera diagnóstico de todos os nichos sem falhas', () => {
  const output = loadCli('diagnostico-sweep.js', {
    '../src/core/compilerWorker': { executarCompilacao: m => ({ xmlFinal: '<xml>' + m.nichoTema + '</xml>' }) },
    '../src/core/diagnostico': { gerarDiagnostico: () => ({ score: 100, totalErros: 0, totalAvisos: 1, categorias: [{ nome: 'SEO', achados: [{ nivel: 'aviso', mensagem: 'Aviso' }] }] }) },
    '../src/core/nichoTaxonomy': { NICHO_PAGE_TYPE_MAP: { blog: 'x', tech: 'y' } },
  });
  assert.deepEqual(output.exits, []);
  assert.match(output.logs.join('\n'), /2\/2 sem erro real/);
  assert.match(output.logs.join('\n'), /Nenhum erro real/);
});

test('sweep reporta falha de compilação e termina com erro', () => {
  const output = loadCli('diagnostico-sweep.js', {
    '../src/core/compilerWorker': { executarCompilacao: () => { throw new Error('falha simulada'); } },
    '../src/core/diagnostico': { gerarDiagnostico: () => { throw new Error('diagnóstico não deveria ser chamado'); } },
    '../src/core/nichoTaxonomy': { NICHO_PAGE_TYPE_MAP: { blog: 'x' } },
  });
  assert.deepEqual(output.exits, [1]);
  assert.match(output.logs.join('\n'), /falha simulada/);
});

test('cleanup recebe dias explícitos e usa somente dependência simulada', async () => {
  const calls = [];
  const output = loadCli('limparProjetosSolarisExpirados.js', {
    dotenv: { config: () => calls.push('dotenv') },
    '../src/solaris/tools/projectStorage': {
      DIAS_RETENCAO_PADRAO: 30,
      apagarProjetosExpirados: async opts => { calls.push(opts.diasParaExpirar); return { apagados: ['p1'], erros: [] }; },
    },
  }, ['45']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['dotenv', 45]);
  assert.deepEqual(output.exits, [0]);
  assert.match(output.logs.join('\n'), /1 projeto/);
});

test('cleanup aplica padrão a dias inválidos sem acessar produção', async () => {
  const calls = [];
  const output = loadCli('limparProjetosSolarisExpirados.js', {
    dotenv: { config() {} },
    '../src/solaris/tools/projectStorage': {
      DIAS_RETENCAO_PADRAO: 30,
      apagarProjetosExpirados: async opts => { calls.push(opts.diasParaExpirar); return { apagados: [], erros: [{ id: 'p1', erro: 'simulado' }] }; },
    },
  }, ['abc']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [30]);
  assert.deepEqual(output.exits, [1]);
});
