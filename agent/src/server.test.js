import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Agent } from "./agent.js";
import { createApp } from "./server.js";
import { Permissions } from "./security/permissions.js";

let envSnapshot;
let tempBase;
let server;
let baseUrl;

async function startTestServer({ sharedSecret } = {}) {
  envSnapshot = { ...process.env };
  if (sharedSecret !== undefined) {
    process.env.WORKER_SHARED_SECRET = sharedSecret;
  } else {
    delete process.env.WORKER_SHARED_SECRET;
  }

  tempBase = await fs.mkdtemp(path.join(os.tmpdir(), "worker-agent-server-test-"));
  const workspaceRoot = path.join(tempBase, "workspace");

  const agent = new Agent({ workspaceRoot, permissions: new Permissions({ mode: "full" }) });
  await agent.start();

  const app = createApp(agent);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  return { agent, baseUrl };
}

async function stopTestServer() {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempBase, { recursive: true, force: true });
  process.env = envSnapshot;
}

test("GET /health responde 200 sem autenticação", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/health`);
    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { status: "ok" });
  } finally {
    await stopTestServer();
  }
});

test("GET /capabilities autenticado lista operações reais", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/capabilities`, {headers:{'x-worker-secret':'segredo-teste'}});
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.storage, undefined);
    assert.equal(body.artifacts, undefined);
    assert.ok(Array.isArray(body.filesystem));
    assert.ok(body.filesystem.includes("edit"));
    assert.deepEqual(body.mcp, ["list_servers", "list_tools", "call_tool"]);
    assert.deepEqual(body["web-fetch"], ["fetch"]);
    assert.deepEqual(body.escalation, ["request", "respond", "get", "list"]);
  } finally {
    await stopTestServer();
  }
});

// Prova de ponta a ponta de que a capability mcp está de fato
// conectada nos 5 pontos de sincronização (protocol.js,
// protocol-adapter.js, task-router.js, agent.js, permissions.js) —
// "list_servers" não faz nenhuma chamada de rede (só lê configuração
// local), então dá pra validar a fiação inteira sem precisar de um
// servidor MCP real aqui (isso é coberto à parte, em
// mcp-client.e2e.test.js).
test("POST /run: mcp.list_servers percorre o pipeline HTTP completo", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [{ id: "a1", capability: "mcp", operation: "list_servers", input: {} }],
      }),
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    const resultado = body.results.find((r) => r.actionId === "a1");
    assert.equal(resultado.ok, true);
    assert.deepEqual(resultado.result, { servers: [] });
  } finally {
    await stopTestServer();
  }
});

// Pipeline HTTP completo de process.start + callback_url/callback_secret,
// SEM nenhum fake -- protocol.js real (parse dos campos snake_case),
// protocol-adapter.js real (rename pra callbackUrl/callbackSecret),
// process.js real, deliverWebhook REAL (não injetado, agent.js não
// expõe nenhum jeito de injetar resolveHostname através da API HTTP --
// de propósito, seria uma porta pra desligar a proteção contra SSRF).
// Por isso o callback aponta pra 127.0.0.1 (não um servidor externo,
// que exigiria rede real neste ambiente de teste) e o teste confirma
// que a proteção contra SSRF de verdade bloqueia a entrega mesmo
// passando pelo pipeline HTTP inteiro -- prova tanto a fiação (os
// campos chegam certos em process.js) quanto que não há atalho pra
// contornar a proteção via protocolo externo.
test("POST /run: process.start com callback_url/callback_secret percorre o pipeline completo (SSRF real bloqueia localhost)", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const startResp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [
          {
            id: "a1",
            capability: "process",
            operation: "start",
            input: {
              command: 'node -e "console.log(1)"',
              callback_url: "http://127.0.0.1:1/callback",
              callback_secret: "segredo-de-teste-com-16-chars",
            },
          },
        ],
      }),
    });

    assert.equal(startResp.status, 200);
    const startBody = await startResp.json();
    const startResult = startBody.results.find((r) => r.actionId === "a1");
    assert.equal(startResult.ok, true);
    const { processId } = startResult.result;
    assert.ok(processId);

    // Poll até o processo (e a tentativa de webhook em seguida)
    // terminarem -- mesmo padrão de espera usado em process.test.js.
    let statusResult;
    const startedAt = Date.now();
    do {
      const statusResp = await fetch(`${url}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
        body: JSON.stringify({
          request_id: "r2",
          task: "execute",
          actions: [{ id: "s1", capability: "process", operation: "status", input: { process_id: processId } }],
        }),
      });
      const statusBody = await statusResp.json();
      statusResult = statusBody.results.find((r) => r.actionId === "s1").result;

      if (statusResult.status === "running" || !statusResult.webhookDelivery) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    } while (
      (statusResult.status === "running" || !statusResult.webhookDelivery) &&
      Date.now() - startedAt < 5000
    );

    assert.equal(statusResult.status, "exited");
    assert.equal(statusResult.exitCode, 0);
    assert.equal(statusResult.webhookDelivery.delivered, false);
    assert.ok(statusResult.webhookDelivery.error.includes("endereço privado/reservado"));
  } finally {
    await stopTestServer();
  }
});

// Canal de escalonamento humano de ponta a ponta: cria via /run
// (escalation.request), responde via a rota HTTP NOVA e dedicada
// (POST /escalations/:id/respond -- não faz parte do protocolo
// genérico de /run), confirma resolvido de volta via /run
// (escalation.get). Prova que as duas entradas (batch genérico e rota
// dedicada) realmente convergem pra mesma EscalationCapability, sem
// nenhuma lógica duplicada.
test("POST /run + POST /escalations/:id/respond: fluxo completo de escalonamento humano", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const requestResp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [
          {
            id: "a1",
            capability: "escalation",
            operation: "request",
            input: { question: "posso fazer deploy em produção agora?" },
          },
        ],
      }),
    });

    assert.equal(requestResp.status, 200);
    const requestBody = await requestResp.json();
    const requestResult = requestBody.results.find((r) => r.actionId === "a1");
    assert.equal(requestResult.ok, true);
    assert.equal(requestResult.result.status, "pending");
    const { id: escalationId } = requestResult.result;

    const respondResp = await fetch(`${url}/escalations/${escalationId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({ decision: "aprovado", note: "confirmado pelo time de infra" }),
    });

    assert.equal(respondResp.status, 200);
    const respondBody = await respondResp.json();
    assert.equal(respondBody.status, "resolved");
    assert.equal(respondBody.decision, "aprovado");

    const getResp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r2",
        task: "execute",
        actions: [
          { id: "g1", capability: "escalation", operation: "get", input: { escalation_id: escalationId } },
        ],
      }),
    });
    const getBody = await getResp.json();
    const getResult = getBody.results.find((r) => r.actionId === "g1");
    assert.equal(getResult.result.status, "resolved");
    assert.equal(getResult.result.decision, "aprovado");
  } finally {
    await stopTestServer();
  }
});

test("POST /escalations/:id/respond: escalonamento inexistente -> 404", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/escalations/nao-existe/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({ decision: "aprovado" }),
    });

    assert.equal(resp.status, 404);
    const body = await resp.json();
    assert.equal(body.error, "ESCALATION_NOT_FOUND");
  } finally {
    await stopTestServer();
  }
});

test("POST /escalations/:id/respond: sem decision -> 400", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const requestResp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [
          { id: "a1", capability: "escalation", operation: "request", input: { question: "posso?" } },
        ],
      }),
    });
    const requestBody = await requestResp.json();
    const { id: escalationId } = requestBody.results.find((r) => r.actionId === "a1").result;

    const resp = await fetch(`${url}/escalations/${escalationId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({}),
    });

    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.equal(body.error, "VALIDATION_ERROR");
  } finally {
    await stopTestServer();
  }
});

test("POST /escalations/:id/respond: responder duas vezes -> 409 na segunda", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const requestResp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [
          { id: "a1", capability: "escalation", operation: "request", input: { question: "posso?" } },
        ],
      }),
    });
    const requestBody = await requestResp.json();
    const { id: escalationId } = requestBody.results.find((r) => r.actionId === "a1").result;

    const primeiraResp = await fetch(`${url}/escalations/${escalationId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({ decision: "aprovado" }),
    });
    assert.equal(primeiraResp.status, 200);

    const segundaResp = await fetch(`${url}/escalations/${escalationId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({ decision: "rejeitado" }),
    });

    assert.equal(segundaResp.status, 409);
    const body = await segundaResp.json();
    assert.equal(body.error, "ESCALATION_ALREADY_RESPONDED");
  } finally {
    await stopTestServer();
  }
});

test("POST /escalations/:id/respond sem secret -> 401 quando WORKER_SHARED_SECRET está configurado", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/escalations/qualquer-id/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "aprovado" }),
    });
    assert.equal(resp.status, 401);
  } finally {
    await stopTestServer();
  }
});

test("POST /run sem secret -> 401 quando WORKER_SHARED_SECRET está configurado", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: "r1", task: "execute", actions: [] }),
    });
    assert.equal(resp.status, 401);
  } finally {
    await stopTestServer();
  }
});

test("POST /run com secret errado -> 401", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "errado" },
      body: JSON.stringify({ request_id: "r1", task: "execute", actions: [] }),
    });
    assert.equal(resp.status, 401);
  } finally {
    await stopTestServer();
  }
});

test("POST /run sem WORKER_SHARED_SECRET falha fechado", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: null });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [{ id: "a1", capability: "filesystem", operation: "list", input: {} }],
      }),
    });
    assert.equal(resp.status, 503);
  } finally {
    await stopTestServer();
  }
});

test("POST /run com payload inválido (fora do schema) -> 400 com detalhe do protocolo", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({ request_id: "r1", task: "execute" }), // falta "actions"
    });
    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.equal(body.error, "INVALID_REQUEST");
  } finally {
    await stopTestServer();
  }
});

test("POST /run executa uma action real (filesystem.write + filesystem.read) ponta a ponta", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [
          { id: "escrever", capability: "filesystem", operation: "write", input: { path: "a.txt", content: "ola mundo" } },
          { id: "ler", capability: "filesystem", operation: "read", input: { path: "a.txt" } },
        ],
      }),
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.requestId, "r1");
    assert.equal(body.results.length, 2);

    const escrever = body.results.find((r) => r.actionId === "escrever");
    assert.equal(escrever.ok, true);
    assert.equal(escrever.taskType, "file.write");

    const ler = body.results.find((r) => r.actionId === "ler");
    assert.equal(ler.ok, true);
    assert.equal(ler.result.content, "ola mundo");
  } finally {
    await stopTestServer();
  }
});

test("POST /run roda as actions em ORDEM (não paralelo) -- write antes de read do mesmo arquivo", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [
          { id: "w1", capability: "filesystem", operation: "write", input: { path: "seq.txt", content: "v1" } },
          { id: "w2", capability: "filesystem", operation: "write", input: { path: "seq.txt", content: "v2" } },
          { id: "r1", capability: "filesystem", operation: "read", input: { path: "seq.txt" } },
        ],
      }),
    });

    const body = await resp.json();
    const leitura = body.results.find((r) => r.actionId === "r1");
    assert.equal(leitura.result.content, "v2");
  } finally {
    await stopTestServer();
  }
});

test("POST /run: uma action com erro de execução não aborta as demais no mesmo lote", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [
          { id: "falha", capability: "filesystem", operation: "read", input: { path: "nao-existe.txt" } },
          { id: "sucesso", capability: "filesystem", operation: "write", input: { path: "ok.txt", content: "x" } },
        ],
      }),
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    const falha = body.results.find((r) => r.actionId === "falha");
    const sucesso = body.results.find((r) => r.actionId === "sucesso");
    assert.equal(falha.ok, false);
    assert.equal(sucesso.ok, true);
  } finally {
    await stopTestServer();
  }
});

test("POST /run: JSON malformado -> 400 (nunca vaza stack trace)", async () => {
  const { baseUrl: url } = await startTestServer({ sharedSecret: "segredo-teste" });
  try {
    const resp = await fetch(`${url}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": "segredo-teste" },
      body: "{ isso nao fecha",
    });
    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.equal(body.error, "invalid_request");
  } finally {
    await stopTestServer();
  }
});
