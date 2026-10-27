'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('rsync repairs equal-size stale staged archive instead of silently skipping it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-rsync-'));
  try {
    const source = path.join(dir, 'source.tar.gz');
    const remote = path.join(dir, 'remote.tar.gz');
    const content = Buffer.alloc(8192, 0x37);
    fs.writeFileSync(source, content);
    fs.writeFileSync(remote, Buffer.alloc(content.length, 0x52));
    assert.equal(fs.statSync(remote).size, fs.statSync(source).size);
    const result = spawnSync('rsync', ['--checksum', '--inplace', '--partial', source, remote], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(remote), content);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deploy never retries based only on inaccessible public health', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/reconcile-deploy.yml'), 'utf8');
  const missing = workflow.indexOf("if (!/^[a-f0-9]{7,40}$/.test(live))");
  const dispatch = workflow.indexOf('await github.rest.actions.createWorkflowDispatch');
  assert.ok(missing > 0 && missing < dispatch);
  assert.match(workflow.slice(missing, dispatch), /skipping deployment retry/);
});
