'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const ignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');

test('image excludes Git metadata and receives truthful release SHA in final layer', () => {
  assert.match(ignore, /^\.git\s*$/m);
  assert.match(ignore, /^\.github\s*$/m);
  assert.match(dockerfile, /ARG GIT_SHA=dev-local/);
  assert.match(dockerfile, /ARG GIT_DATE=unknown/);
  assert.match(dockerfile, /printf '%s\\n' "\$GIT_SHA" > \/usr\/src\/app\/GIT_SHA/);
  assert.doesNotMatch(dockerfile, /git rev-parse|git log -1|apt-get install -y --no-install-recommends git/);
  assert.match(workflow, /--build-arg "GIT_SHA=\$GITHUB_SHA"/);
  assert.match(workflow, /--build-arg "GIT_DATE=\$commit_date"/);
  assert.match(workflow, /docker run --rm --entrypoint cat "\$image" \/usr\/src\/app\/GIT_SHA/);
  assert.match(workflow, /test "\$actual" = "\$GITHUB_SHA"/);
});

test('GitHub-hosted BuildKit caches layers and preserves signed/resumable transfer flow', () => {
  assert.match(workflow, /docker\/setup-buildx-action@v3/);
  assert.match(workflow, /docker buildx build --load/);
  assert.match(workflow, /--cache-from 'type=gha,scope=softload-\$\{\{ matrix.service \}\}'/);
  assert.match(workflow, /--cache-to 'type=gha,scope=softload-\$\{\{ matrix.service \}\},mode=max,ignore-error=true'/);
  assert.match(workflow, /docker save 'softload-\$\{\{ matrix.service \}\}:\$\{\{ github.sha \}\}' \| gzip -1/);
  assert.match(workflow, /rsync --checksum --inplace --partial/);
  assert.doesNotMatch(workflow, /rsync --append-verify/);
  assert.match(workflow, /sha256sum "\$archive"/);
  assert.match(workflow, /'reuse:\$\{\{ matrix.service \}\}:\$\{\{ github.sha \}\}'/);
});
