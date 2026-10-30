#!/usr/bin/env bash
# Offline boot: no production credentials, ports or persistent volumes.
set -euo pipefail
image="${1:?production image required}"
cid="$(docker run -d --network none \
  -e NODE_ENV=test -e SESSION_SECRET=ci-session-not-for-production \
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
    assert.match(await response.text(), /<html/i, route);
  }
  const protectedPage = await fetch('http://127.0.0.1:8080/dashboard', {redirect: 'manual'});
  assert.equal(protectedPage.status, 302);
  assert.match(protectedPage.headers.get('location'), /^\/login/);
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
  console.log('CONTAINER_SMOKE_OK: EJS, authenticated boundary, three real Blogger XML niches');
})().catch(error => {console.error(error); process.exitCode = 1;});
NODE
