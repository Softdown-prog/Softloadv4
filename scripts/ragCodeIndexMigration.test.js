'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadCorpus, indexCorpus } = require('./ragCodeIndex');
const { entryId } = require('./codeCorpus/codeCollector');

const repo = 'example/project';
const code = 'function createApp() {\n  const name = "Solaris";\n  return Array.from({length: 15}, (_, i) => name + "-" + i).join(",");\n}\n';
const sha = 'a'.repeat(40);
const validEntry = () => ({
  id: entryId(repo, 'examples/demo.js'), repo, path: 'examples/demo.js',
  sourceUrl: 'https://github.com/' + repo + '/blob/' + sha + '/examples/demo.js',
  language: 'javascript', license: 'MIT', commitSha: sha,
  code, contentHash: crypto.createHash('sha256').update(code).digest('hex'),
  validated: false,
});
function withDirectory(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-code-index-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('indexador: importa somente entrada verificada; ignora symlinks e nomes inesperados', () => withDirectory(dir => {
  const entry = validEntry();
  const name = entry.id + '.json';
  fs.writeFileSync(path.join(dir, name), JSON.stringify(entry));
  fs.writeFileSync(path.join(dir, 'unrelated.json'), '{bad data');
  fs.symlinkSync(path.join(dir, name), path.join(dir, 'code-' + 'b'.repeat(32) + '.json'));
  const imported = loadCorpus(dir, 5);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].entry.id, entry.id);
  assert.ok(imported[0].chunks.length > 0);
  assert.deepEqual(loadCorpus(path.join(dir, 'not-found')), []);
}));

test('indexador: rejeita alterações de conteúdo, licença e origem', () => withDirectory(dir => {
  const name = validEntry().id + '.json';
  const dest = path.join(dir, name);
  const invalid = [
    { code: code + '\n// modificado' },
    { license: 'GPL-3.0' },
    { sourceUrl: 'http://invalid/unsafe' },
    { contentHash: 'f'.repeat(64) },
    { commitSha: 'invalid' },
    { path: 'examples/test.exe' },
  ];
  for (const patch of invalid) {
    fs.writeFileSync(dest, JSON.stringify({ ...validEntry(), ...patch }));
    assert.throws(() => loadCorpus(dir), /inválida|Hash inválido/);
  }
}));

test('indexador: dry-run não usa Firestore nem embeddings e contabiliza chunks', async () => {
  const entry = validEntry();
  const result = await indexCorpus({ entries: [{ entry, chunks: ['a', 'b'] }] });
  assert.deepEqual(result, { entries: 1, chunks: 2, indexed: 0, unchanged: 0, errors: [] });
});

test('indexador: falha isolada de embeddings não interrompe outras entradas', async () => {
  const entry = validEntry();
  let attempts = 0;
  const db = { collection() { return { doc() { return { get: async () => ({ exists: false }) }; } }; } };
  const report = await indexCorpus({ apply: true, db, entries: [
    { entry, chunks: ['a'] },
    { entry: { ...entry, id: 'code-' + 'b'.repeat(32) }, chunks: ['b'] },
  ], embedFn: async () => { attempts++; throw Error('embedding offline'); } });
  assert.equal(attempts, 2);
  assert.equal(report.entries, 2);
  assert.equal(report.indexed, 0);
  assert.deepEqual(report.errors.map(x => x.error), ['embedding offline', 'embedding offline']);
});
