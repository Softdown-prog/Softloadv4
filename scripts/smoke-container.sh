#!/usr/bin/env bash
# Offline boot: no production credentials, ports or persistent volumes.
set -euo pipefail
image="${1:?production image required}"
cid="$(docker run -d --network none \
  -e NODE_ENV=test -e SOFTLOAD_USE_ANGULAR=true -e SESSION_SECRET=ci-session-not-for-production \
  -e FIREBASE_API_KEY=ci-only -e FIREBASE_APP_ID=ci-only \
  -e GOOGLE_CLOUD_PROJECT=blogger-ci \
  -e FIRESTORE_EMULATOR_HOST=127.0.0.1:9 "$image")"
trap 'docker rm -f "$cid" >/dev/null' EXIT
for attempt in $(seq 1 30); do
  if docker exec "$cid" node -e "fetch('http://127.0.0.1:8080/login').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 1
done
docker exec -i "$cid" node <<'NODE'
const assert = require('node:assert/strict');
(async () => {
  for (const route of ['/', '/login', '/recover']) {
    const response = await fetch('http://127.0.0.1:8080' + route);
    assert.equal(response.status, 200, route);
    const html=await response.text();
    assert.match(html, /<html/i, route);
    assert.match(html, /<sl-root\b/i, route + ' must render canonical Angular shell');
  }
  const editor = await fetch('http://127.0.0.1:8080/criar');
  assert.equal(editor.status,200,'guest editor must load');
  assert.match(await editor.text(),/<sl-root\b/i,'guest editor must be Angular');
  // Guard every private hard-refresh route at Express level, not just in
  // Angular's client router. This container has no real Firebase access.
  for (const route of [
    '/dashboard','/dashboard/gerador-blogger','/dashboard/historico',
    '/dashboard/arquivos','/dashboard/configuracoes','/dashboard/upgrade',
    '/dashboard/plano-essencial'
  ]) {
    const page=await fetch('http://127.0.0.1:8080'+route,{redirect:'manual'});
    assert.equal(page.status,302,'guest must not load '+route);
    assert.match(page.headers.get('location')||'',/^\/login\?/,'guest login redirect '+route);
  }
  for(const route of ['/eu','/eu/usuarios']){
    const page=await fetch('http://127.0.0.1:8080'+route,{redirect:'manual'});
    assert.equal(page.status,404,'private admin route must be hidden '+route);
  }
  const files=await fetch('http://127.0.0.1:8080/api/frontend/files',{
    headers:{accept:'application/json'},redirect:'manual'
  });
  assert.equal(files.status,401,'private files API must not expose account data');
  assert.match(files.headers.get('content-type')||'',/application\/json/);
  const pricing=await fetch('http://127.0.0.1:8080/planos');
  assert.equal(pricing.status,200,'public pricing route must not require login');
  assert.match(await pricing.text(),/<sl-root\b/);
  // Exercise the real compiler inside the built image, isolating only telemetry I/O.
  const id = require.resolve('./src/core/telemetria');
  require.cache[id] = {id, filename: id, loaded: true, exports: {registrarCompilacao() {}}};
  const {executarCompilacao} = require('./src/core/compilerWorker');
  const {validarXmlEstrutura, validarSemanticaBlogger} = require('./src/core/xmlValidator');
  for (const nichoTema of ['tecnologia-mag-tech', 'culinaria-boutique-gourmet', 'aquarela']) {
    const {xmlFinal} = executarCompilacao({siteName: 'Docker Blogger', nichoTema, colorPreset: 'tech-blue', typography: 'inter'});
    assert.deepEqual(validarXmlEstrutura(xmlFinal).erros, []);
    assert.deepEqual(validarSemanticaBlogger(xmlFinal).erros, []);
    assert.match(xmlFinal, /Blog1/);
  }
  console.log('CONTAINER_SMOKE_OK: Angular, authenticated boundary, three real Blogger XML niches');
})().catch(error => {console.error(error); process.exitCode = 1;});
NODE
