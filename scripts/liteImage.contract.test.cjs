'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const file = name => fs.readFileSync(path.join(root,name), 'utf8');

test('the production App and pilot both package Blogger without React/Forge/Python', () => {
  const prod=file('Dockerfile');
  const pilot=file('Dockerfile.lite');
  const deploy=file('.github/workflows/deploy.yml');
  assert.match(deploy, /dockerfile:\s*Dockerfile\s*\n/);
  assert.doesNotMatch(deploy, /dockerfile:\s*Dockerfile\.lite\s*\n/);
  for(const [name,df] of [['production',prod],['pilot',pilot]]) {
    assert.match(df, /^FROM node:20-slim AS vendor$/m, name);
    assert.match(df, /^COPY server\.js \.\/$/m, name);
    assert.match(df, /^COPY src \.\/src$/m, name);
    assert.match(df, /^COPY views \.\/views$/m, name);
    assert.match(df, /^COPY --from=vendor \/usr\/src\/app\/public\/vendor \.\/public\/vendor$/m, name);
    assert.doesNotMatch(df, /frontend-build|COPY frontend|COPY \. \.|npm run build|python3|ffmpeg|agent\/forge|solaris-forge/, name);
    assert.match(df, /test ! -d \/usr\/src\/app\/agent/, name);
    assert.match(df, /test ! -e \/usr\/src\/app\/views\/pages\/forge-2d\.ejs/, name);
    assert.match(df, /test ! -e \/usr\/src\/app\/src\/routes\/dashboard_routes\/forgeStandalone\.cjs/, name);
    assert.match(df, /node scripts\/vendorTemplateRefs\.js/, name);
    assert.match(df, /require\('\.\/src\/routes\/apiRoutes'\)/, name);
    assert.match(df, /CMD \["node", "server\.js"\]/, name);
  }
  assert.match(prod, /ARG GIT_SHA=dev-local/);
  assert.match(prod, /GIT_SHA" > \/usr\/src\/app\/GIT_SHA/);
});

test('production context removes Forge, frontend and secrets without touching Agent build context',()=>{
  const ignore=file('Dockerfile.dockerignore').split(/\r?\n/);
  const pilotIgnore=file('Dockerfile.lite.dockerignore').split(/\r?\n/);
  for(const item of ['.git','.github','.env','/frontend','/agent','/public/dist']) {
    assert.ok(ignore.includes(item), 'prod ignore: '+item);
    assert.ok(pilotIgnore.includes(item), 'pilot ignore: '+item);
  }
  // As antigas páginas/bridges Forge foram removidas do Git, não apenas omitidas no Docker.
  for(const item of ['views/pages/forge-2d.ejs',
    'src/routes/dashboard_routes/forgeStandalone.cjs',
    'src/routes/dashboard_routes/forgeStandalone.js',
    'src/routes/dashboard_routes/forgeStandalone.ts']) {
    assert.equal(fs.existsSync(path.join(root,item)), false, 'rota Forge ainda versionada: '+item);
  }
  assert.match(file('agent/Dockerfile'),/^FROM node:22-bookworm-slim$/m);
});

test('pilot workflow only builds and inspects; cannot deploy to VPS',()=>{
  const wf=file('.github/workflows/lite-image-ci.yml');
  assert.match(wf, /pull_request:/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /docker build .*Dockerfile\.lite/);
  assert.match(wf, /docker image inspect/);
  assert.doesNotMatch(wf,/docker (push|compose (up|down)|image rm|system prune)|ssh\s|rsync\s|registry|kubectl|gcloud|scp\s/i);
});
