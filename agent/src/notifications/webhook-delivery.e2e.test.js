import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { deliverWebhook, verifyWebhookSignature } from "./webhook-delivery.js";

/**
 * Teste de ponta a ponta GENUÍNO: `fetch` GLOBAL real (nenhum
 * `fetchImpl` injetado, diferente de `webhook-delivery.test.js`) e um
 * servidor HTTP real rodando localmente, que RECEBE o webhook e
 * verifica a assinatura com `verifyWebhookSignature` do lado receptor
 * -- prova que os dois lados (entrega + verificação) realmente
 * funcionam juntos sobre HTTP de verdade, não só que cada função
 * isolada faz o que devia segundo seus próprios testes de unidade.
 */
const SECRET = "segredo-e2e-com-pelo-menos-16-chars";

let server;
let baseUrl;
let receivedRequests;

before(async () => {
  server = http.createServer((req, res) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", () => {
      const valido = verifyWebhookSignature({
        secret: SECRET,
        rawBody,
        signatureHeader: req.headers["x-softload-webhook-signature"],
      });

      receivedRequests.push({
        rawBody,
        headers: req.headers,
        assinaturaValida: valido,
      });

      if (!valido) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "assinatura inválida" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ recebido: true }));
    });
  });

  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(() => {
  receivedRequests = [];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function resolveLoopbackAsPublic() {
  return async (hostname) => {
    if (hostname === "127.0.0.1") {
      return [{ address: "93.184.216.34", family: 4 }];
    }
    return [];
  };
}

test("e2e: entrega real, servidor recebe e confirma a assinatura de verdade", async () => {
  const payload = { evento: "processo.terminado", processId: "abc-123", exitCode: 0 };

  const result = await deliverWebhook({
    url: `${baseUrl}/callback`,
    secret: SECRET,
    payload,
    resolveHostname: resolveLoopbackAsPublic(),
    // fetchImpl NÃO passado -- usa o fetch global real.
  });

  assert.equal(result.delivered, true);
  assert.equal(result.statusCode, 200);

  assert.equal(receivedRequests.length, 1);
  assert.equal(receivedRequests[0].assinaturaValida, true);
  assert.deepEqual(JSON.parse(receivedRequests[0].rawBody), payload);
});

test("e2e: servidor real rejeita quando o segredo usado pra assinar é diferente do dele", async () => {
  const result = await deliverWebhook({
    url: `${baseUrl}/callback`,
    secret: "segredo-completamente-diferente-do-servidor",
    payload: { x: 1 },
    resolveHostname: resolveLoopbackAsPublic(),
  });

  // A entrega em si "funciona" (o servidor respondeu), mas com 401 --
  // deliverWebhook não sabe o que é uma assinatura válida do ponto de
  // vista do receptor, só entrega; quem decide é o servidor.
  assert.equal(result.delivered, false);
  assert.equal(result.statusCode, 401);

  assert.equal(receivedRequests[0].assinaturaValida, false);
});

test("e2e: sem resolveHostname injetado (comportamento real de produção), loopback é bloqueado", async () => {
  const result = await deliverWebhook({
    url: `${baseUrl}/callback`,
    secret: SECRET,
    payload: { x: 1 },
    // resolveHostname NÃO passado -- dns.lookup real bloqueia 127.0.0.1.
  });

  assert.equal(result.delivered, false);
  assert.ok(result.error.includes("endereço privado/reservado"));
  assert.equal(receivedRequests.length, 0);
});
