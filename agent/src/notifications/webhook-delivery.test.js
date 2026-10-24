import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { deliverWebhook, verifyWebhookSignature } from "./webhook-delivery.js";

const VALID_SECRET = "segredo-com-pelo-menos-16-chars";

function publicResolver() {
  return async () => [{ address: "93.184.216.34", family: 4 }];
}

test("deliverWebhook: exige url", async () => {
  await assert.rejects(
    () => deliverWebhook({ secret: VALID_SECRET, payload: {} }),
    /exige url/,
  );
});

test("deliverWebhook: exige secret com pelo menos 16 caracteres", async () => {
  await assert.rejects(
    () => deliverWebhook({ url: "https://exemplo.com", secret: "curto", payload: {} }),
    /mínimo 16 caracteres/,
  );
});

test("deliverWebhook: exige payload", async () => {
  await assert.rejects(
    () => deliverWebhook({ url: "https://exemplo.com", secret: VALID_SECRET }),
    /exige payload/,
  );
});

test("deliverWebhook: entrega bem-sucedida (2xx) -- delivered:true", async () => {
  let capturedRequest;

  const fetchImpl = async (url, init) => {
    capturedRequest = { url, init };
    return new Response("ok", { status: 200 });
  };

  const result = await deliverWebhook({
    url: "https://exemplo.com/callback",
    secret: VALID_SECRET,
    payload: { processId: "abc", status: "exited" },
    fetchImpl,
    resolveHostname: publicResolver(),
  });

  assert.equal(result.delivered, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.error, null);
  assert.ok(result.deliveryId);
  assert.ok(result.attemptedAt);

  assert.equal(capturedRequest.url, "https://exemplo.com/callback");
  assert.equal(capturedRequest.init.method, "POST");
  assert.equal(capturedRequest.init.redirect, "manual");
  assert.equal(capturedRequest.init.headers["Content-Type"], "application/json");
  assert.equal(capturedRequest.init.body, JSON.stringify({ processId: "abc", status: "exited" }));
});

test("deliverWebhook: assina o corpo corretamente (HMAC-SHA256 verificável)", async () => {
  let capturedHeaders;

  const fetchImpl = async (_url, init) => {
    capturedHeaders = init.headers;
    return new Response("ok", { status: 200 });
  };

  const payload = { evento: "processo terminado", exitCode: 0 };

  await deliverWebhook({
    url: "https://exemplo.com/callback",
    secret: VALID_SECRET,
    payload,
    fetchImpl,
    resolveHostname: publicResolver(),
  });

  const expectedSignature = createHmac("sha256", VALID_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");

  assert.equal(
    capturedHeaders["X-Softload-Webhook-Signature"],
    `sha256=${expectedSignature}`,
  );
  assert.ok(capturedHeaders["X-Softload-Webhook-Id"]);
  assert.ok(capturedHeaders["X-Softload-Webhook-Timestamp"]);
});

test("deliverWebhook: resposta não-2xx vira falha de entrega, com snippet do corpo", async () => {
  const fetchImpl = async () => new Response("erro interno do receptor", { status: 500 });

  const result = await deliverWebhook({
    url: "https://exemplo.com/callback",
    secret: VALID_SECRET,
    payload: {},
    fetchImpl,
    resolveHostname: publicResolver(),
  });

  assert.equal(result.delivered, false);
  assert.equal(result.statusCode, 500);
  assert.ok(result.error.includes("500"));
  assert.ok(result.error.includes("erro interno do receptor"));
});

test("deliverWebhook: redirecionamento (3xx) NÃO é seguido -- vira falha de entrega", async () => {
  let callCount = 0;

  const fetchImpl = async () => {
    callCount += 1;
    return new Response(null, { status: 302, headers: { location: "https://outro-host.com/" } });
  };

  const result = await deliverWebhook({
    url: "https://exemplo.com/callback",
    secret: VALID_SECRET,
    payload: {},
    fetchImpl,
    resolveHostname: publicResolver(),
  });

  assert.equal(callCount, 1);
  assert.equal(result.delivered, false);
  assert.equal(result.statusCode, 302);
});

test("deliverWebhook: URL bloqueada por SSRF vira falha de entrega, não lança", async () => {
  let fetchCalled = false;

  const result = await deliverWebhook({
    url: "http://169.254.169.254/latest/meta-data",
    secret: VALID_SECRET,
    payload: {},
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("não deveria ter sido chamado");
    },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.statusCode, null);
  assert.ok(result.error.includes("host sempre bloqueado"));
  assert.equal(fetchCalled, false);
});

test("deliverWebhook: falha de rede vira falha de entrega, não lança", async () => {
  const result = await deliverWebhook({
    url: "https://exemplo.com/callback",
    secret: VALID_SECRET,
    payload: {},
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
    resolveHostname: publicResolver(),
  });

  assert.equal(result.delivered, false);
  assert.ok(result.error.includes("ECONNREFUSED"));
});

test("deliverWebhook: timeout vira falha de entrega, não lança", async () => {
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });

  const result = await deliverWebhook({
    url: "https://exemplo.com/callback",
    secret: VALID_SECRET,
    payload: {},
    fetchImpl,
    resolveHostname: publicResolver(),
    timeoutMs: 20,
  });

  assert.equal(result.delivered, false);
  assert.ok(result.error.includes("timeout"));
});

test("deliverWebhook: timeoutMs acima do teto rígido é limitado (não trava o teste)", async () => {
  const fetchImpl = async () => new Response("ok", { status: 200 });

  const result = await deliverWebhook({
    url: "https://exemplo.com/callback",
    secret: VALID_SECRET,
    payload: {},
    fetchImpl,
    resolveHostname: publicResolver(),
    timeoutMs: 999999999,
  });

  assert.equal(result.delivered, true);
});

test("verifyWebhookSignature: assinatura válida retorna true", () => {
  const rawBody = JSON.stringify({ ok: true });
  const signature = createHmac("sha256", VALID_SECRET).update(rawBody).digest("hex");

  const valid = verifyWebhookSignature({
    secret: VALID_SECRET,
    rawBody,
    signatureHeader: `sha256=${signature}`,
  });

  assert.equal(valid, true);
});

test("verifyWebhookSignature: assinatura inválida retorna false", () => {
  const rawBody = JSON.stringify({ ok: true });

  const valid = verifyWebhookSignature({
    secret: VALID_SECRET,
    rawBody,
    signatureHeader: "sha256=0000000000000000000000000000000000000000000000000000000000000000",
  });

  assert.equal(valid, false);
});

test("verifyWebhookSignature: segredo diferente retorna false", () => {
  const rawBody = JSON.stringify({ ok: true });
  const signature = createHmac("sha256", VALID_SECRET).update(rawBody).digest("hex");

  const valid = verifyWebhookSignature({
    secret: "outro-segredo-completamente-diferente",
    rawBody,
    signatureHeader: `sha256=${signature}`,
  });

  assert.equal(valid, false);
});

test("verifyWebhookSignature: header sem prefixo sha256= retorna false", () => {
  const valid = verifyWebhookSignature({
    secret: VALID_SECRET,
    rawBody: "{}",
    signatureHeader: "abc123",
  });

  assert.equal(valid, false);
});

test("verifyWebhookSignature: header ausente/malformado nunca lança", () => {
  assert.equal(
    verifyWebhookSignature({ secret: VALID_SECRET, rawBody: "{}", signatureHeader: undefined }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({ secret: VALID_SECRET, rawBody: "{}", signatureHeader: "sha256=" }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({
      secret: VALID_SECRET,
      rawBody: "{}",
      signatureHeader: "sha256=zzz-nao-e-hex",
    }),
    false,
  );
});

test("verifyWebhookSignature: corpo alterado invalida a assinatura", () => {
  const rawBody = JSON.stringify({ valor: 100 });
  const signature = createHmac("sha256", VALID_SECRET).update(rawBody).digest("hex");

  const corpoAlterado = JSON.stringify({ valor: 999 });

  const valid = verifyWebhookSignature({
    secret: VALID_SECRET,
    rawBody: corpoAlterado,
    signatureHeader: `sha256=${signature}`,
  });

  assert.equal(valid, false);
});
