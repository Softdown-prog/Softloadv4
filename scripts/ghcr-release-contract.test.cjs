'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, '.github/workflows/ghcr-bootstrap-private.yml'), 'utf8');
const stage = fs.readFileSync(path.join(root, '.github/workflows/ghcr-stage-private.yml'), 'utf8');

test('GHCR workflows are manual and do not touch VPS', () => {
  for (const contents of [bootstrap, stage]) {
    assert.match(contents, /\n  workflow_dispatch:/);
    assert.doesNotMatch(contents, /\n  push:|\n  schedule:/);
    assert.match(contents, /packages: write/);
    assert.doesNotMatch(contents, /root@164\.163\.9\.7|docker compose up|caddy reload|softload-wake/);
  }
});
test('bootstrap publishes only inert images, and checks privacy before app staging', () => {
  assert.match(bootstrap, /FROM scratch/);
  assert.doesNotMatch(bootstrap, /COPY\s+.*\.|softload-app/);
  assert.match(bootstrap, /\[ "\$visibility" != private \]/);
  const check=stage.indexOf('Require package privacy BEFORE building or publishing code');
  const build=stage.indexOf('Build and upload image only to confirmed private package');
  assert.ok(check>0 && build>check);
  assert.match(stage, /\[ "\$visibility" != private \]/);
  assert.match(stage, /org\.opencontainers\.image\.revision=/);
  assert.match(stage, /sha-\$GITHUB_SHA/);
  assert.doesNotMatch(stage, /--platform linux\/arm64/);
});

test('GHCR image builds locally and is not pushed before second privacy and SHA gate', () => {
  const build = stage.indexOf('Build image locally (no publish yet)');
  const secondGate = stage.indexOf('Recheck main revision and package privacy immediately before push');
  const push = stage.indexOf('Push image and capture immutable digest');
  const postCheck = stage.indexOf('Check private visibility again after image upload');
  assert.ok(build > 0 && secondGate > build && push > secondGate && postCheck > push);
  assert.match(stage, /docker buildx build --load --platform linux\/amd64/);
  assert.doesNotMatch(stage, /docker buildx build --push/);
  assert.match(stage, /docker push "\$image"/);
  assert.match(stage.slice(secondGate, push), /\[ "\$visibility" != private \]/);
  assert.match(stage.slice(secondGate, push), /"\$latest" != "\$GITHUB_SHA"/);
  assert.match(stage, /\[\[ "\$digest" =~ \^sha256:/);
  assert.match(stage, /\$REGISTRY@\$DIGEST/);
});
