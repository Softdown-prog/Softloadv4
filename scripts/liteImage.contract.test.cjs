'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const file=(name)=>fs.readFileSync(path.join(root,name),'utf8');

test('production and pilot build Blogger-only images, while deployment keeps App+Agent contract',()=>{
  const pilot=file('Dockerfile.lite');
  const deploy=file('.github/workflows/deploy.yml');
  const stable=file('Dockerfile');
  assert.match(deploy,/dockerfile:\s*Dockerfile\s*\n/);
  assert.doesNotMatch(deploy,/dockerfile:\s*Dockerfile\.lite\s*\n/);
  assert.doesNotMatch(stable,/FROM node:20-slim AS frontend-build|npm run build|COPY frontend|COPY \\. \\./);
  for(const artifact of ['server.js','src','views','public','scripts','manifests']) assert.match(stable,new RegExp('^COPY '+artifact+' ', 'm'));
  assert.doesNotMatch(stable,/python3|ffmpeg|agent\\/forge|COPY --from=frontend-build/);
  assert.doesNotMatch(pilot,/\bRUN\s+npm run build\b|\bRUN\s+vite\b/);
  assert.doesNotMatch(pilot,/^COPY\s+frontend(?:\/|\s)/m);
  assert.doesNotMatch(pilot,/^COPY\s+\.\s+\./m,'avoid shipping the entire repo');
  assert.match(pilot,/^COPY server\.js \./m);
  assert.match(pilot,/^COPY src \.\/src/m);
  assert.match(pilot,/^COPY views \.\/views/m);
  assert.match(pilot,/^COPY --from=vendor \/usr\/src\/app\/public\/vendor \.\/public\/vendor/m);
  assert.doesNotMatch(pilot,/agent\/forge|python3|ffmpeg|solaris-forge|FROM node:20-slim AS frontend-build/);
  assert.match(pilot,/node scripts\/vendorTemplateRefs\.js/);
  assert.match(pilot,/require\('\.\/src\/routes\/authRoutes'\)/);
  assert.match(pilot,/require\('\.\/src\/routes\/apiRoutes'\)/);
  assert.match(pilot,/CMD \["node", "server\.js"\]/);
});

test('pilot context explicitly excludes React/Agent runtime, secrets and old dist',()=>{
  const ignore=file('Dockerfile.lite.dockerignore');
  for(const item of ['.git','.github','.env','/frontend','/agent','/public/dist']){
    assert.ok(ignore.split(/\r?\n/).includes(item),'missing ignore '+item);
  }
  const prod=file('Dockerfile');
  const prodIgnore=file('Dockerfile.dockerignore');
  for(const item of ['.git','.github','.env','/frontend','/agent','/public/dist','/views/pages/forge-2d.ejs','/src/routes/dashboard_routes/forgeStandalone.cjs']){
    assert.ok(prodIgnore.split(/\\r?\\n/).includes(item),'production ignore missing '+item);
  }
  assert.match(prod,/test ! -e \\/usr\\/src\\/app\\/views\\/pages\\/forge-2d\\.ejs/);
  const pilot=file('Dockerfile.lite');
  assert.match(pilot,/test ! -d \/usr\/src\/app\/frontend/);
  assert.match(pilot,/test ! -d \/usr\/src\/app\/agent/);
  assert.match(pilot,/test ! -e \/usr\/src\/app\/public\/dist\/assets\/main\.js/);
});

test('CI builds pilot image without publishing or activating it',()=>{
  const wf=file('.github/workflows/lite-image-ci.yml');
  assert.match(wf,/pull_request:/);
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf,/docker build .*Dockerfile\.lite/);
  assert.match(wf,/docker image inspect/);
  assert.doesNotMatch(wf,/docker (push|compose (up|down)|image rm|system prune)|ssh\s|rsync\s|registry|kubectl|gcloud|scp\s/i);
});
