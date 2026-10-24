#!/usr/bin/env bash
set -euo pipefail

# Container sem acesso externo: todos os pedidos HTTP sao locais.
container="archive-smoke-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup() {
  docker logs "$container" || true
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run -d --name "$container" --network none \
  -e SANDBOX_SHARED_SECRET=test-only-secret \
  softload-sandbox:archive-slim >/dev/null

for attempt in $(seq 1 30); do
  if docker exec "$container" node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "::error::Arquivo sandbox não iniciou" >&2
    exit 1
  fi
  sleep 1
done

docker exec "$container" node --input-type=module -e '
import assert from "node:assert/strict";
const base = "http://127.0.0.1:8080";
const auth = { "x-sandbox-secret": "test-only-secret" };
const health = await fetch(base + "/health");
assert.equal(health.status, 200);
const missingAuth = await fetch(base + "/run", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
});
assert.equal(missingAuth.status, 401);
const browser = await fetch(base + "/run", {
  method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{}",
});
assert.equal(browser.status, 503);
assert.equal((await browser.json()).error, "capability_unavailable");
const archive = await fetch(base + "/extract-zip", {
  method: "POST", headers: auth, body: Buffer.from("invalid zip"),
});
assert.equal(archive.status, 200);
assert.equal((await archive.json()).success, false);
console.log("[SMOKE] archive-slim OK: health, auth, browser 503, ZIP rejection");
'
