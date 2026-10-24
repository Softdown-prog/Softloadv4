'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { chunkCode, wordCount, containsPotentialSecret, languageFor } = require('../../../scripts/codeCorpus/codeChunker');
const { collectCode, entryId, validateLimit } = require('../../../scripts/codeCorpus/codeCollector');
const { loadCorpus, indexCorpus } = require('../../../scripts/ragCodeIndex');
const { COLLECTION, replaceCodeVectors, findCodeVectors } = require('../../../scripts/codeCorpus/codeVectorStore');
const { buscarCodigo, buscarConhecimentoMisto } = require('../../../scripts/codeCorpus/codeSearchService');
const { criarFakeFirestore } = require('./__testUtils__/fakeFirestore');

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const SUBTREE = 'c'.repeat(40);
const BLOB = 'd'.repeat(40);
const repo = 'expressjs/express';
const code = 'function createServer() {\n  const express = require("express");\n  const app = express();\n  app.get("/health", (_req, res) => res.send("ok"));\n  return app;\n}\nmodule.exports = { createServer };\n';
const manifest = {
  schemaVersion: 1,
  allowLicenses: ['MIT'],
  repositories: [{ repo, prefix: 'examples/', maxFiles: 10 }],
};
const vector = Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0);

function fakeGithub({ license = 'MIT', content = code } = {}) {
  return async url => {
    let payload;
    if (url.endsWith('/repos/expressjs/express/')) {
      payload = { private: false, archived: false, default_branch: 'main', license: { spdx_id: license } };
    } else if (url.endsWith('/commits/main')) {
      payload = { sha: SHA, commit: { tree: { sha: TREE } } };
    } else if (url.endsWith('/git/trees/' + TREE)) {
      payload = { tree: [{ path: 'examples', type: 'tree', sha: SUBTREE }] };
    } else if (url.endsWith('/git/trees/' + SUBTREE + '?recursive=1')) {
      payload = { truncated: false, tree: [{ path: 'basic.js', type: 'blob', size: Buffer.byteLength(content), sha: BLOB }] };
    } else if (url.endsWith('/git/blobs/' + BLOB)) {
      payload = { encoding: 'base64', content: Buffer.from(content).toString('base64') };
    } else {
      throw new Error('URL inesperada: ' + url);
    }
    return { ok: true, json: async () => payload };
  };
}
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-code-test-'));
  return Promise.resolve().then(() => fn(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test('chunker conserva recuos e limites sem cortar linha', () => {
  const source = Array.from({ length: 40 }, (_, i) =>
    '  const value' + i + ' = doWork(first, second, third);').join('\n');
  const chunks = chunkCode(source, 30);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(x => wordCount(x) <= 30));
  assert.equal(chunks.join('\n'), source);
  assert.equal(languageFor('examples/test.tsx'), 'typescript');
  assert.equal(languageFor('example.exe'), null);
  assert.throws(() => chunkCode('x', 251), /inválido/);
});

test('possíveis segredos são rejeitados antes da coleta', () => {
  assert.equal(containsPotentialSecret('const password = "abcdefghijklmno";'), true);
  assert.equal(containsPotentialSecret('-----BEGIN PRIVATE KEY-----'), true);
  assert.equal(containsPotentialSecret(code), false);
});

test('coleta no GitHub exige licença, preserva origem e não roda código', async () =>
  withTempDir(async dir => {
    const fetchImpl = fakeGithub();
    const report = await collectCode({ manifest, limit: 3, apply: false, outDir: dir, fetchImpl });
    assert.equal(report.collected, 1);
    assert.equal(fs.readdirSync(dir).length, 0);
    const saved = await collectCode({ manifest, limit: 3, apply: true, outDir: dir, fetchImpl });
    assert.equal(saved.collected, 1);
    const entry = JSON.parse(fs.readFileSync(path.join(dir, entryId(repo, 'examples/basic.js') + '.json')));
    assert.equal(entry.license, 'MIT');
    assert.equal(entry.commitSha, SHA);
    assert.equal(entry.validated, false);
    assert.equal(entry.code, code);
    const again = await collectCode({ manifest, limit: 3, apply: true, outDir: dir, fetchImpl });
    assert.equal(again.unchanged, 1);
    assert.equal(fs.readdirSync(dir).length, 1);
  })
);

test('fonte sem licença aprovada e código suspeito não entram no corpus', async () =>
  withTempDir(async dir => {
    const noLicense = await collectCode({ manifest, limit: 2, apply: true, outDir: dir, fetchImpl: fakeGithub({ license: 'GPL-3.0' }) });
    assert.equal(noLicense.collected, 0);
    assert.ok(noLicense.errors.some(x => x.includes('Licença')));
    const suspicious = await collectCode({ manifest, limit: 2, apply: true, outDir: dir,
      fetchImpl: fakeGithub({ content: code + '\nconst password = "abcdefghijklmno";' }) });
    assert.equal(suspicious.collected, 0);
    assert.equal(suspicious.skipped, 1);
    assert.deepEqual(fs.readdirSync(dir), []);
  })
);

test('índice de código tem coleção própria, replace e busca vetorial', async () => {
  const db = criarFakeFirestore();
  const entry = { id: entryId(repo, 'examples/basic.js'), repo, path: 'examples/basic.js',
    language: 'javascript', sourceUrl: 'https://github.com/' + repo + '/blob/' + SHA + '/examples/basic.js',
    commitSha: SHA, license: 'MIT', contentHash: crypto.createHash('sha256').update(code).digest('hex'),
    validated: false };
  await replaceCodeVectors({ db, entry, chunks: ['function first() {}', 'function second() {}'], embeddings: [vector, vector] });
  assert.equal(db._dump(COLLECTION).size, 2);
  await replaceCodeVectors({ db, entry, chunks: ['function first() {}'], embeddings: [vector] });
  assert.equal(db._dump(COLLECTION).size, 1);
  assert.equal(db._dump('solaris_rag_vectors').size, 0);
  const matches = await findCodeVectors({ db, queryEmbedding: vector, topK: 3 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].license, 'MIT');
  assert.equal(matches[0].validated, false);
  await assert.rejects(replaceCodeVectors({ db, entry, chunks: ['x'], embeddings: [[1, 2]] }), /768/);
});

test('indexador dry-run não grava e reindexação igual economiza embeddings', async () =>
  withTempDir(async dir => {
    const id = entryId(repo, 'examples/basic.js');
    const entry = { id, code, repo, path: 'examples/basic.js', language: 'javascript',
      sourceUrl: 'https://github.com/' + repo + '/blob/' + SHA + '/examples/basic.js',
      commitSha: SHA, license: 'MIT', contentHash: crypto.createHash('sha256').update(code).digest('hex'),
      validated: false };
    fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(entry));
    assert.throws(() => validateLimit(1001), /Limite/);
    const entries = loadCorpus(dir, 5);
    const db = criarFakeFirestore();
    const dry = await indexCorpus({ entries, db });
    assert.equal(dry.chunks, 1);
    assert.equal(db._dump(COLLECTION).size, 0);
    let calls = 0;
    const embedFn = async ({ taskType, textos }) => {
      calls++;
      assert.equal(taskType, 'RETRIEVAL_DOCUMENT');
      return textos.map(() => vector);
    };
    const saved = await indexCorpus({ entries, db, embedFn, apply: true });
    assert.equal(saved.indexed, 1);
    const repeat = await indexCorpus({ entries, db, embedFn, apply: true });
    assert.equal(repeat.unchanged, 1);
    assert.equal(calls, 1);
  })
);

test('busca mista mantém o RAG legado em falha ou flag desabilitada', async () => {
  const opts = {
    query: 'código React', topK: 3, db: {},
    catalogFn: async () => ({ query: 'código React', resultados: [{ entryId: 'cat', texto: 'boas práticas' }] }),
    codeFn: async () => ({ resultados: [{ entryId: 'code-1', texto: 'código testado' }] }),
  };
  const old = await buscarConhecimentoMisto(opts);
  assert.deepEqual(old.resultados.map(x => x.entryId), ['cat']);
  const both = await buscarConhecimentoMisto({ ...opts, codeSearchEnabled: true });
  assert.deepEqual(both.resultados.map(x => x.entryId), ['code-1', 'cat']);
  const prev = console.warn;
  console.warn = () => {};
  try {
    const fallback = await buscarConhecimentoMisto({ ...opts, codeSearchEnabled: true,
      codeFn: async () => { throw new Error('index missing'); } });
    assert.deepEqual(fallback.resultados.map(x => x.entryId), ['cat']);
  } finally { console.warn = prev; }
  const queried = await buscarCodigo({ query: 'api do Node', db: {},
    gerarEmbeddingsFn: async ({ taskType }) => {
      assert.equal(taskType, 'RETRIEVAL_QUERY'); return [vector];
    },
    findFn: async ({ queryEmbedding, topK }) => {
      assert.equal(queryEmbedding.length, 768); assert.equal(topK, 3); return [];
    },
  });
  assert.deepEqual(queried.resultados, []);
});
