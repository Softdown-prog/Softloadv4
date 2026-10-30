'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
function heredoc(marker) {
  const match = workflow.match(new RegExp("<<'" + marker + "'\\n([\\s\\S]*?)^          " + marker + '$', 'm'));
  assert.ok(match, marker);
  return match[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
}

test('encrypted delivery authenticates bytes, repository, run, SHA and service before decryption', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-delivery-'));
  try {
    const app = path.join(folder, 'app');
    fs.mkdirSync(app);
    const plain = Buffer.from('production image bytes\0' + 'a'.repeat(10000));
    fs.writeFileSync(path.join(folder, 'plain'), plain);
    const env = { ...process.env, DEPLOY_KEY: 'test-only-not-a-real-key',
      GITHUB_REPOSITORY: 'Softdown-prog/Softloadv4', GITHUB_RUN_ID: '123',
      GITHUB_SHA: 'a'.repeat(40), SERVICE: 'app', DELIVERY_DIR: folder };
    env.ARTIFACT_PASSWORD = 'softload-artifact-v1:' + env.DEPLOY_KEY;
    const cipher = path.join(app, 'image.enc');
    execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-salt',
      '-pass', 'env:ARTIFACT_PASSWORD', '-in', path.join(folder, 'plain'), '-out', cipher], { env });
    execFileSync('python3', ['-c', heredoc('PYMAC'), app], { env });
    const verify = extra => spawnSync('python3', ['-c', heredoc('PYVERIFY')], {
      env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(verify().status, 0);
    for (const field of ['DEPLOY_KEY', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_SHA']) {
      assert.notEqual(verify({ [field]: 'different' }).status, 0, field);
    }
    fs.rmSync(path.join(app, 'image.mac'));
    assert.notEqual(verify().status, 0, 'required authentication tag cannot be omitted');
    execFileSync('python3', ['-c', heredoc('PYMAC'), app], { env });
    const encrypted = fs.readFileSync(cipher);
    assert.equal(encrypted.includes(plain), false);
    const corrupt = Buffer.from(encrypted);
    corrupt[40] ^= 1;
    fs.writeFileSync(cipher, corrupt);
    assert.notEqual(verify().status, 0, 'tampered cipher rejected before decryption');
    fs.writeFileSync(cipher, encrypted);
    const decoded = execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2',
      '-iter', '200000', '-pass', 'env:ARTIFACT_PASSWORD', '-in', cipher], { env });
    assert.deepEqual(decoded, plain);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('VPS downloader is the tested script, runs without checkout, and authenticates before loading', () => {
  const embedded = heredoc('PYHTTPS').trim();
  const source = fs.readFileSync(path.join(root, 'scripts/vps/download_artifact_https.py'), 'utf8').trim();
  assert.equal(embedded, source);
  const receive = workflow.split('  receive:')[1].split('  activate:')[0];
  assert.doesNotMatch(receive.replace(/^\s*#.*$/gm, ''), /uses: actions\/checkout|docker (?:load|run|compose)|sudo\s+(?!-n true)/);
  assert.match(receive, /github\.ref == 'refs\/heads\/main'/);
  assert.match(receive, /ip route get 164\.163\.9\.7/);
  assert.match(receive, /grep -q '\^local '/);
  assert.ok(receive.indexOf('Authenticate encrypted artifacts') < receive.indexOf('Load both images'));
  assert.match(receive, /Remove decrypted images and temporary credentials\n        if: always\(\)/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /needs: receive/);
  assert.match(workflow, /payload.status === "ok".*expected === live/);
  assert.doesNotMatch(workflow, /seq 1 24|180s rsync/);
});

test('parallel HTTPS handles ranges and rejects unsafe archives offline', () => {
  execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'scripts/vps',
    '-p', 'test_download_artifact_https.py', '-v'], { cwd: root, stdio: 'pipe' });
});
