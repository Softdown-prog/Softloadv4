'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectCode, parseManifest, validateLimit, entryId, DEFAULT_LIMIT } =
  require('../../../scripts/codeCorpus/codeCollector');

const manifest = {
  schemaVersion: 1,
  allowLicenses: ['MIT'],
  repositories: [{ repo: 'sample/demo', prefix: 'src/', maxFiles: 10 }],
};

test('corpus: contrato de limites e identificadores estaveis', () => {
  assert.equal(DEFAULT_LIMIT, 40);
  assert.match(entryId('sample/demo', 'src/app.js'), /^code-[a-f0-9]{32}$/);
  assert.equal(entryId('sample/demo', 'src/app.js'), entryId('sample/demo', 'src/app.js'));
  assert.notEqual(entryId('sample/demo', 'src/app.js'), entryId('sample/demo', 'src/other.js'));
  for (const value of [0, -1, 1.2, 1001, NaN]) {
    assert.throws(() => validateLimit(value), /Limite/);
  }
  assert.equal(validateLimit(1000), 1000);
});

test('corpus: manifesta so repositorios e licencas explicitamente aprovados', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solar-code-manifest-'));
  const file = path.join(root, 'sources.json');
  try {
    for (const bad of [
      { ...manifest, allowLicenses: [] },
      { ...manifest, repositories: [{ repo: 'sample/demo', prefix: '../', maxFiles: 10 }] },
      { ...manifest, repositories: [{ repo: 'sample/demo', prefix: 'src/', maxFiles: 0 }] },
      { ...manifest, repositories: [{ repo: 'wrong name', prefix: 'src/', maxFiles: 10 }] },
    ]) {
      fs.writeFileSync(file, JSON.stringify(bad));
      assert.throws(() => parseManifest(file), /inválido|inválida/);
    }
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.deepEqual(parseManifest(file), manifest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('corpus: HTTP indisponivel, repositorios privados e licencas negadas nao escrevem', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solar-code-safe-'));
  try {
    for (const response of [
      { ok: false, status: 403, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({
        private: true, archived: false, license: { spdx_id: 'MIT' },
      }) },
      { ok: true, status: 200, json: async () => ({
        private: false, archived: false, license: { spdx_id: 'GPL-3.0' },
      }) },
    ]) {
      const calls = [];
      const fetchImpl = async (url, init) => {
        calls.push(url);
        assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
        return response;
      };
      const report = await collectCode({ manifest, outDir: root, apply: true, fetchImpl, token: '' });
      assert.equal(report.collected, 0);
      assert.equal(report.unchanged, 0);
      assert.equal(report.errors.length, 1);
      assert.equal(calls.length, 1);
      assert.deepEqual(fs.readdirSync(root), []);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('corpus: limite invalido falha antes de consultar rede', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('nao chamar'); };
  await assert.rejects(
    () => collectCode({ manifest, limit: 0, fetchImpl }),
    /Limite/
  );
  assert.equal(calls, 0);
});
