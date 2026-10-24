import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Permissions } from "../security/permissions.js";
import { CommandPolicy } from "../security/command-policy.js";
import { Workspace } from "../core/workspace.js";
import { ProcessCapability } from "./process.js";

let tempDir;
let workspace;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "process-capability-test-"));
  workspace = new Workspace({ root: tempDir });
  await workspace.initialize();
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function permissivePermissions() {
  return new Permissions({
    permissions: {
      "process.start": true,
      "process.status": true,
      "process.output": true,
      "process.kill": true,
    },
  });
}

function buildCapability({ deliverWebhookFn } = {}) {
  return new ProcessCapability({
    workspace,
    permissions: permissivePermissions(),
    commandPolicy: new CommandPolicy(),
    deliverWebhookFn,
  });
}

async function waitUntilFinished(capability, processId, { timeoutMs = 3000 } = {}) {
  const startedAt = Date.now();

  for (;;) {
    const status = await capability.execute({ type: "process.status", processId });

    if (status.status !== "running") {
      return status;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`processo ${processId} não terminou em ${timeoutMs}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("execute: nega ação sem permissão (fail-closed)", async () => {
  const capability = new ProcessCapability({
    workspace,
    permissions: new Permissions({ permissions: { "process.start": false } }),
    commandPolicy: new CommandPolicy(),
  });

  await assert.rejects(
    () => capability.execute({ type: "process.start", command: "node --version" }),
    /Permissão negada/,
  );
});

test("execute: tipo de task desconhecido lança erro", async () => {
  const capability = new ProcessCapability({
    workspace,
    permissions: new Permissions({ mode: "full" }),
    commandPolicy: new CommandPolicy(),
  });

  await assert.rejects(
    () => capability.execute({ type: "process.algo_inventado" }),
    /Operação process desconhecida/,
  );
});

test("process.start: exige command", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "process.start" }),
    /exige 'command'/,
  );
});

test("process.start: comando fora da allowlist é bloqueado pela CommandPolicy", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "process.start", command: "whoami" }),
    /Executável não permitido/,
  );
});

test("process.start: callbackUrl sem callbackSecret é rejeitado", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () =>
      capability.execute({
        type: "process.start",
        command: "node -e \"1\"",
        callbackUrl: "https://exemplo.com/callback",
      }),
    /precisam ser informados JUNTOS/,
  );
});

test("process.start: callbackSecret sem callbackUrl é rejeitado", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () =>
      capability.execute({
        type: "process.start",
        command: "node -e \"1\"",
        callbackSecret: "segredo-qualquer-com-16-chars",
      }),
    /precisam ser informados JUNTOS/,
  );
});

test("process.start + status: roda um processo real até o fim", async () => {
  const capability = buildCapability();

  const started = await capability.execute({
    type: "process.start",
    command: 'node -e "console.log(\'ola\')"',
  });

  assert.equal(started.status, "running");
  assert.ok(started.processId);

  const finalStatus = await waitUntilFinished(capability, started.processId);

  assert.equal(finalStatus.status, "exited");
  assert.equal(finalStatus.exitCode, 0);
  assert.equal(finalStatus.webhookDelivery, null);

  const output = await capability.execute({ type: "process.output", processId: started.processId });
  assert.ok(output.stdout.includes("ola"));
});

test("process.status/output: processId desconhecido lança erro claro", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "process.status", processId: "não-existe" }),
    /Processo não encontrado/,
  );

  await assert.rejects(
    () => capability.execute({ type: "process.output", processId: "não-existe" }),
    /Processo não encontrado/,
  );
});

test("process.kill: mata um processo de longa duração", async () => {
  const capability = buildCapability();

  const started = await capability.execute({
    type: "process.start",
    command: 'node -e "setInterval(() => {}, 1000)"',
  });

  const killed = await capability.execute({ type: "process.kill", processId: started.processId });
  assert.equal(killed.status, "killed");

  const status = await capability.execute({ type: "process.status", processId: started.processId });
  assert.equal(status.status, "killed");
});

test("process.start: sem callbackUrl, webhookDelivery permanece null e a função não é chamada", async () => {
  let called = false;

  const capability = buildCapability({
    deliverWebhookFn: async () => {
      called = true;
      return { delivered: true };
    },
  });

  const started = await capability.execute({
    type: "process.start",
    command: 'node -e "1"',
  });

  await waitUntilFinished(capability, started.processId);

  assert.equal(called, false);
});

test("process.start: com callback configurado, dispara o webhook com o payload certo ao terminar", async () => {
  let capturedCall;

  const capability = buildCapability({
    deliverWebhookFn: async (args) => {
      capturedCall = args;
      return { delivered: true, deliveryId: "d1", statusCode: 200, error: null, attemptedAt: Date.now() };
    },
  });

  const started = await capability.execute({
    type: "process.start",
    command: 'node -e "console.log(\'saida\')"',
    callbackUrl: "https://exemplo.com/callback",
    callbackSecret: "segredo-de-teste-com-16-chars",
  });

  const finalStatus = await waitUntilFinished(capability, started.processId);

  assert.equal(capturedCall.url, "https://exemplo.com/callback");
  assert.equal(capturedCall.secret, "segredo-de-teste-com-16-chars");
  assert.equal(capturedCall.payload.processId, started.processId);
  assert.equal(capturedCall.payload.status, "exited");
  assert.equal(capturedCall.payload.exitCode, 0);
  assert.ok(capturedCall.payload.stdout.includes("saida"));
  assert.ok(Number.isInteger(capturedCall.payload.durationMs));

  assert.deepEqual(finalStatus.webhookDelivery, {
    delivered: true,
    deliveryId: "d1",
    statusCode: 200,
    error: null,
    attemptedAt: finalStatus.webhookDelivery.attemptedAt,
  });
});

test("process.start: falha de entrega do webhook fica registrada, sem derrubar o processo", async () => {
  const capability = buildCapability({
    deliverWebhookFn: async () => ({
      delivered: false,
      deliveryId: "d2",
      statusCode: 500,
      error: "resposta não-2xx (500)",
      attemptedAt: Date.now(),
    }),
  });

  const started = await capability.execute({
    type: "process.start",
    command: 'node -e "1"',
    callbackUrl: "https://exemplo.com/callback",
    callbackSecret: "segredo-de-teste-com-16-chars",
  });

  const finalStatus = await waitUntilFinished(capability, started.processId);

  assert.equal(finalStatus.status, "exited");
  assert.equal(finalStatus.webhookDelivery.delivered, false);
  assert.equal(finalStatus.webhookDelivery.error, "resposta não-2xx (500)");
});

test("process.start: deliverWebhookFn lançando inesperadamente não derruba o fluxo (defesa em profundidade)", async () => {
  const capability = buildCapability({
    deliverWebhookFn: async () => {
      throw new Error("erro totalmente inesperado");
    },
  });

  const started = await capability.execute({
    type: "process.start",
    command: 'node -e "1"',
    callbackUrl: "https://exemplo.com/callback",
    callbackSecret: "segredo-de-teste-com-16-chars",
  });

  const finalStatus = await waitUntilFinished(capability, started.processId);

  assert.equal(finalStatus.status, "exited");
  assert.equal(finalStatus.webhookDelivery.delivered, false);
  assert.equal(finalStatus.webhookDelivery.error, "erro totalmente inesperado");
});

test("process.start: comando que falha (exit code != 0) ainda dispara o webhook com o status certo", async () => {
  let capturedCall;

  const capability = buildCapability({
    deliverWebhookFn: async (args) => {
      capturedCall = args;
      return { delivered: true, deliveryId: "d3", statusCode: 200, error: null, attemptedAt: Date.now() };
    },
  });

  const started = await capability.execute({
    type: "process.start",
    command: "node -e \"process.exit(7)\"",
    callbackUrl: "https://exemplo.com/callback",
    callbackSecret: "segredo-de-teste-com-16-chars",
  });

  await waitUntilFinished(capability, started.processId);

  assert.equal(capturedCall.payload.status, "exited");
  assert.equal(capturedCall.payload.exitCode, 7);
});
