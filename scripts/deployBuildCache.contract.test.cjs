'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const ignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
test('Docker excludes Git history while retaining truthful build metadata', () => {
  assert.match(ignore, /^\.git\s*$/m);
  assert.match(dockerfile, /ARG SOURCE_GIT_SHA=unknown/);
  assert.match(dockerfile, /ARG SOURCE_GIT_DATE=unknown/);
  assert.match(dockerfile, /COPY --from=build-info \/GIT_SHA \/usr\/src\/app\/GIT_SHA/);
  assert.doesNotMatch(dockerfile, /git rev-parse|git log -1|apt-get install -y --no-install-recommends git/);
  assert.match(workflow, /--build-arg "SOURCE_GIT_SHA=\$GITHUB_SHA"/);
  assert.match(workflow, /--build-arg "SOURCE_GIT_DATE=\$date_iso"/);
});
test('app caches expensive build layers but does not change VPS delivery protocol', () => {
  assert.match(workflow, /docker\/setup-buildx-action@v3/);
  assert.match(workflow, /docker buildx build --load/);
  assert.match(workflow, /--cache-from type=gha,scope=softload-app/);
  assert.match(workflow, /--cache-to type=gha,mode=max,scope=softload-app/);
  assert.match(workflow, /docker save 'softload-\$\{\{ matrix.service \}\}:\$\{\{ github.sha \}\}' \| gzip -6/);
  assert.match(workflow, /rsync --append-verify --partial/);
  assert.match(workflow, /sha256sum "\$archive"/);
  assert.match(workflow, /'reuse:\$\{\{ matrix.service \}\}:\$\{\{ github.sha \}\}'/);
});
