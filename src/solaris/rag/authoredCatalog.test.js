'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadAuthoredCorpus, CATALOG } = require('../../../scripts/codeCorpus/authoredCatalog');

test('catálogo original contém oito receitas documentadas, rastreáveis e aptas para embeddings', () => {
  const entries = loadAuthoredCorpus({ limit: 50 });
  assert.equal(entries.length, 15);
  assert.equal(new Set(entries.map(x => x.entry.id)).size, entries.length);
  for (const { entry, chunks } of entries) {
    assert.match(entry.id, /^code-[a-f0-9]{32}$/);
    assert.equal(entry.origin, 'softload-authored');
    assert.equal(entry.validated, false);
    assert.ok(entry.sourceUrl.startsWith('https://github.com/Softdown-prog/softload-engine-v3/blob/main/'));
    assert.ok(chunks.length);
    assert.ok(chunks.every(c => c.trim().split(/\s+/).length <= 220));
    assert.ok(chunks[0].includes(entry.title));
    assert.ok(chunks[0].includes('Código:'));
  }
});
test('catálogo rejeita duplicatas e path traversal', () => {
  const file = path.join(os.tmpdir(), 'solaris-authored-' + process.pid + '.json');
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  try {
    catalog.entries.push({ ...catalog.entries[0] });
    fs.writeFileSync(file, JSON.stringify(catalog));
    assert.throws(() => loadAuthoredCorpus({ limit: 20, catalogFile: file }), /duplicada/);
    catalog.entries[0].path = 'src/solaris/code-examples/../../.env';
    fs.writeFileSync(file, JSON.stringify(catalog));
    assert.throws(() => loadAuthoredCorpus({ limit: 20, catalogFile: file }), /não permitido/);
  } finally { fs.rmSync(file, { force: true }); }
});

test('segundo lote preserva cada fonte autoral e suas linguagens', () => {
  const entries = loadAuthoredCorpus({ limit: 50 });
  const second = entries.filter(x => x.entry.path.startsWith('examples/solaris-code/'));
  assert.equal(second.length, 7);
  assert.equal(second.filter(x => x.entry.language === 'typescript').length, 5);
  assert.equal(second.filter(x => x.entry.language === 'javascript').length, 2);
  assert.ok(second.every(x => x.entry.origin === 'softload-authored'));
});
