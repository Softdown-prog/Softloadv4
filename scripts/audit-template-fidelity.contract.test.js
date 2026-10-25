'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const jsSource = fs.readFileSync(path.join(__dirname, 'audit-template-fidelity.js'), 'utf8');
function loadModule({ compiler, originals = {}, niches = {}} = {}) {
  const mod = { exports: {} };
  const fakeFs = {
    ...fs,
    existsSync(file) { return file.includes('/exemplos/') ? Object.hasOwn(originals, path.basename(file, '.xml')) : fs.existsSync(file); },
    readFileSync(file, encoding) { return file.includes('/exemplos/') ? originals[path.basename(file, '.xml')] : fs.readFileSync(file, encoding); },
  };
  const fakeRequire = (id) => {
    if (id === 'fs') return fakeFs;
    if (id === 'path') return path;
    if (id === '../src/core/compilerWorker') return {
      executarCompilacao: ({ nichoTema }) => {
        if (nichoTema === 'crash') throw Error('compilation failed');
        return { xmlFinal: compiler?.[nichoTema] || '<b:section id="main"/>' };
      },
    };
    if (id === '../src/core/diagnostico') return {
      gerarDiagnostico: () => ({ score: 100, totalErros: 0, totalAvisos: 0, categorias: [] }),
    };
    if (id === '../src/core/nichoTaxonomy') return { NICHO_PAGE_TYPE_MAP: niches };
    throw Error('Unexpected dependency ' + id);
  };
  fakeRequire.main = null;
  vm.runInNewContext(jsSource, {
    module: mod, exports: mod.exports, require: fakeRequire, __dirname: __dirname,
    console: {log() {},error() {}}, Buffer, process: {argv: []},
  }, {filename:'audit-template-fidelity.js'});
  return mod.exports;
}

test('structural coverage uses 75/25 weights, aliases and never claims visual fidelity', () => {
  const { signatures, comparison } = loadModule();
  const before = signatures('<b:section id="header-top"/><b:section id="main"/><b:widget type="HTML"/><b:widget type="Blog"/>');
  const after = signatures('<b:section id="header-logo"/><b:widget type="Blog"/>');
  const result = comparison(before, after, {'header-top':'header-logo'});
  assert.equal(result.scoreEstrutural, 50);
  assert.deepEqual(JSON.parse(JSON.stringify(result.renamedSections)), [{oldId:'header-top',newId:'header-logo'}]);
  assert.deepEqual(Array.from(result.missingSections), ['main']);
  assert.deepEqual(Array.from(result.missingWidgets), ['HTML']);
  const empty = comparison(signatures('<html></html>'),signatures('<html></html>'));
  assert.equal(empty.scoreEstrutural, null);
  assert.equal(empty.sectionCoverage, null);
});

test('audit groups valid, absent-reference and failed compilations without inventing scores', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-structure-'));
  try {
    const { run } = loadModule({
      niches: { 'has-ref': {}, 'no-ref': {}, crash: {} },
      originals: {'has-ref': '<b:section id="one"/><b:section id="two"/><b:section id="three"/><b:section id="four"/>'},
      compiler: {'has-ref':'<b:section id="one"/>','no-ref':'<b:section id="no-ref"/>'},
    });
    const report = run({outDir:dir});
    assert.equal(report.kind, 'structural-not-visual');
    assert.equal(report.summary.total, 3);
    assert.deepEqual(Array.from(report.summary.blocked), ['has-ref','crash']);
    assert.equal(report.niches[0].reference.scoreEstrutural, 25);
    assert.equal(report.niches[1].reference, null);
    assert.equal(report.niches[1].blocked, false);
    assert.equal(report.niches[2].compilationError, 'compilation failed');
    assert.ok(fs.readFileSync(path.join(dir, 'fidelity.md'),'utf8').includes('Não representa nota visual'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'fidelity.json'),'utf8')).schemaVersion,1);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test('named Bootstrap components and repeated sections give deterministic signatures', () => {
  const { signatures } = loadModule();
  const a = signatures('<b:section id="duplicate"/><b:section id="duplicate"/><b:section id="alpha"/><b:widget type="Blog"/>'+ 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'+'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js');
  assert.deepEqual(Array.from(a.sections), ['alpha','duplicate']);
  assert.equal(a.bootstrapCss5,true);
  assert.equal(a.bootstrapJs5,true);
});
