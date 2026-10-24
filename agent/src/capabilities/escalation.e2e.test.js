import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { Permissions } from "../security/permissions.js";
import { EscalationCapability } from "./escalation.js";
import { deliverWebhook, verifyWebhookSignature } from "../notifications/webhook-delivery.js";

/**
 * Teste de ponta a ponta GENUÍNO: usa a função REAL `deliverWebhook`
 * (não um fake) contra um servidor HTTP real rodando localmente, que
 * verifica a assinatura HMAC de verdade do lado receptor -- mesma
 * técnica de `webhook-delivery.e2e.test.js`/`web-fetch.e2e.test.js`:
 * só a RESOLUÇÃO DNS do host de teste é fabricada (pra permitir testar
 * contra 127.0.0.1 sem reabrir loopback na proteção real contra SSRF
 * usada em produção); tudo mais -- assinatura, entrega HTTP, corpo do
 * webhook -- é comportamento real de `deliverWebhook`.
 */
const SECRET = "segredo-e2e-escalation-16-chars";

let server;
let baseUrl;
let receivedWebhooks;

before(async () => {
  server = http.createServer((req, res) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", () => {
      const assinaturaValida = verifyWebhookSignature({
        secret: SECRET,
        rawBody,
        signatureHeader: req.headers["x-softload-webhook-signature"],
      });

      receivedWebhooks.push({ payload: JSON.parse(rawBody), assinaturaValida });

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
  receivedWebhooks = [];
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

function buildRealCapability() {
  return new EscalationCapability({
    permissions: new Permissions({ mode: "full" }),
    // deliverWebhookFn usa a função REAL deliverWebhook -- só o
    // resolveHostname é fabricado, ver comentário do arquivo.
    deliverWebhookFn: (args) =>
      deliverWebhook({ ...args, resolveHostname: resolveLoopbackAsPublic() }),
  });
}

test("e2e: escalation.request entrega um webhook real, assinado, verificável do lado receptor", async () => {
  const capability = buildRealCapability();

  const created = await capability.execute({
    type: "escalation.request",
    question: "posso fazer deploy em produção agora?",
    context: { ambiente: "producao", pr: 685 },
    callbackUrl: `${baseUrl}/webhook`,
    callbackSecret: SECRET,
  });

  assert.equal(created.status, "pending");
  assert.equal(created.webhookDelivery.delivered, true);
  assert.equal(created.webhookDelivery.statusCode, 200);

  assert.equal(receivedWebhooks.length, 1);
  assert.equal(receivedWebhooks[0].assinaturaValida, true);
  assert.equal(receivedWebhooks[0].payload.escalationId, created.id);
  assert.equal(receivedWebhooks[0].payload.question, "posso fazer deploy em produção agora?");
  assert.deepEqual(receivedWebhooks[0].payload.context, { ambiente: "producao", pr: 685 });
});

test("e2e: fluxo completo -- request dispara webhook real, respond resolve, get confirma", async () => {
  const capability = buildRealCapability();

  const created = await capability.execute({
    type: "escalation.request",
    question: "aprova o merge?",
    callbackUrl: `${baseUrl}/webhook`,
    callbackSecret: SECRET,
  });

  assert.equal(receivedWebhooks.length, 1);

  const responded = await capability.execute({
    type: "escalation.respond",
    escalationId: created.id,
    decision: "aprovado",
  });

  assert.equal(responded.status, "resolved");

  const fetched = await capability.execute({ type: "escalation.get", escalationId: created.id });
  assert.equal(fetched.status, "resolved");
  assert.equal(fetched.decision, "aprovado");
});

test("e2e: sem resolveHostname fabricado (comportamento real de produção), loopback é bloqueado", async () => {
  const capability = new EscalationCapability({
    permissions: new Permissions({ mode: "full" }),
    // deliverWebhookFn NÃO injetado -- usa deliverWebhook real, que
    // por sua vez usa dns.lookup real (resolveHostname default).
  });

  const created = await capability.execute({
    type: "escalation.request",
    question: "posso?",
    callbackUrl: `${baseUrl}/webhook`,
    callbackSecret: SECRET,
  });

  assert.equal(created.webhookDelivery.delivered, false);
  assert.ok(created.webhookDelivery.error.includes("endereço privado/reservado"));
  assert.equal(receivedWebhooks.length, 0);
});
