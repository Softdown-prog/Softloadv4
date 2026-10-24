'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const filename = require.resolve('./dossieWriter');
const source = fs.readFileSync(filename, 'utf8');
const nicho = 'appstore-bulma-mobile';
const actualPath = path.join(__dirname, '../../../src/rag/rag-ia-compiler/pipeline/temas', 'tema-' + nicho + '-dossie.json');
const base = {
  nicho, versaoDossie: 1, chassis: 'blog', pageType: 'catalogo-produtos',
  tokensCss: { light_mode: { '--tw-primary': '#000' } },
  pecas: [{ id:'existente', tipo:'modulo', protegida:false, domIds:[], css:'', html:'', js:'' }],
};
const piece = id => ({id, tipo:'modulo', protegida:false, domIds:[], css:'', html:'', js:''});
// Simulação completa de disco/loader: nenhum arquivo real é modificado.
function harness(failRename = false) {
  const events = [], files = new Map();
  let clears = 0;
  const mockFs = {
    writeFileSync(file, content, encoding) {
      assert.equal(encoding, 'utf-8'); events.push('write'); files.set(file,content);
    },
    renameSync(from,to) {
      events.push('rename');
      if (failRename) throw Error('falha no rename');
      assert.equal(files.has(from),true);
      files.set(to,files.get(from)); files.delete(from);
    },
  };
  const loader = {
    carregarNichoDossie(n) { return n === nicho ? base : null; },
    limparCache() { clears++; events.push('cache'); },
  };
  const validator = {
    validarDossie(d) {
      events.push('validate');
      return { erros: d.pecas.some(p=>p && p.id === 'invalida') ? ['peça inválida'] : [], avisos:[] };
    },
  };
  const m = new Module(filename, module);
  m.filename = filename; m.paths = module.paths;
  m.require = id => id === 'fs' ? mockFs
    : id === './dossieLoader' ? loader
    : id === './dossieValidator' ? validator : require(id);
  m._compile(source, filename);
  return { api:m.exports, events, files, get clears(){return clears;} };
}
{
  const h = harness();
  assert.deepEqual(h.api.adicionarPeca(nicho,piece('nova')),{ok:true,erros:[]});
  assert.deepEqual(h.events,['validate','write','rename','cache']);
  assert.deepEqual(JSON.parse(h.files.get(actualPath)).pecas.map(p=>p.id),['existente','nova']);
  assert.equal(h.files.has(actualPath+'.tmp'),false);
  assert.equal(h.clears,1);
}
{
  const h = harness();
  assert.equal(h.api.adicionarPeca(nicho,piece('existente')).ok,false);
  assert.equal(h.api.adicionarPeca(nicho,null).ok,false);
  assert.equal(h.api.adicionarPeca('nao-existe',piece('novo')).ok,false);
  assert.equal(h.events.length,0);
  assert.equal(h.api.adicionarPeca(nicho,piece('invalida')).ok,false);
  assert.deepEqual(h.events,['validate']);
  assert.equal(h.files.size,0);
}
{
  const h = harness();
  assert.equal(h.api.substituirPecas(nicho,[]).ok,true);
  assert.deepEqual(JSON.parse(h.files.get(actualPath)).pecas,[]);
  assert.deepEqual(h.events,['validate','write','rename','cache']);
}
{
  const h = harness();
  assert.equal(h.api.substituirPecas(nicho,null).ok,false);
  assert.equal(h.api.substituirPecas('nao-existe',[]).ok,false);
  assert.equal(h.api.substituirPecas(nicho,[piece('invalida')]).ok,false);
  assert.equal(h.files.size,0);
  assert.equal(h.clears,0);
}
{
  const h = harness();
  const result = h.api.substituirDossieCompleto(nicho,{
    tokensCss:{light_mode:{'--tw-primary':'#123456'}},pecas:[piece('nova')]
  });
  assert.deepEqual(result,{ok:true,erros:[]});
  const written=JSON.parse(h.files.get(actualPath));
  assert.equal(written.chassis,'blog');
  assert.equal(written.tokensCss.light_mode['--tw-primary'],'#123456');
  assert.deepEqual(written.pecas.map(p=>p.id),['nova']);
}
{
  const h = harness();
  assert.equal(h.api.substituirDossieCompleto(nicho,{tokensCss:null,pecas:[]}).ok,false);
  assert.equal(h.api.substituirDossieCompleto(nicho,{tokensCss:{},pecas:null}).ok,false);
  assert.equal(h.api.substituirDossieCompleto(nicho,{tokensCss:{},pecas:[piece('invalida')]}).ok,false);
  assert.equal(h.api.substituirDossieCompleto('nao-existe',{tokensCss:{},pecas:[]}).ok,false);
  assert.equal(h.files.size,0);
}
for (const op of ['add','replace','complete']) {
  const h = harness(true);
  assert.throws(()=>{
    if(op==='add')h.api.adicionarPeca(nicho,piece('nova'));
    if(op==='replace')h.api.substituirPecas(nicho,[]);
    if(op==='complete')h.api.substituirDossieCompleto(nicho,{tokensCss:{},pecas:[]});
  },/falha no rename/);
  assert.equal(h.files.has(actualPath),false);
  assert.equal(h.files.has(actualPath+'.tmp'),true);
  assert.equal(h.clears,0);
}
console.log('✅ dossieWriter: regressões isoladas de validação e escrita atômica.');
