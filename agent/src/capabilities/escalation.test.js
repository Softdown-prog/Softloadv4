import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Permissions } from "../security/permissions.js";
import { EscalationCapability } from "./escalation.js";

function permissivePermissions() {
  return new Permissions({
    permissions: {
      "escalation.request": true,
      "escalation.respond": true,
      "escalation.get": true,
      "escalation.list": true,
    },
  });
}

let capability;
let deliverWebhookCalls;

beforeEach(() => {
  deliverWebhookCalls = [];

  capability = new EscalationCapability({
    permissions: permissivePermissions(),
    deliverWebhookFn: async (args) => {
      deliverWebhookCalls.push(args);
      return {
        delivered: true,
        deliveryId: "fake-delivery",
        statusCode: 200,
        error: null,
        attemptedAt: Date.now(),
      };
    },
  });
});

test("execute: nega ação sem permissão (fail-closed)", async () => {
  const restricted = new EscalationCapability({
    permissions: new Permissions({ permissions: { "escalation.request": false } }),
  });

  await assert.rejects(
    () => restricted.execute({ type: "escalation.request", question: "posso?" }),
    /Permissão negada/,
  );
});

test("execute: tipo de task desconhecido lança erro (mode full)", async () => {
  const full = new EscalationCapability({ permissions: new Permissions({ mode: "full" }) });

  await assert.rejects(
    () => full.execute({ type: "escalation.algo_inventado" }),
    /Operação escalation desconhecida/,
  );
});

test("escalation.request: exige question", async () => {
  await assert.rejects(
    () => capability.execute({ type: "escalation.request" }),
    /exige question/,
  );
});

test("escalation.request: callbackUrl sem callbackSecret é rejeitado", async () => {
  await assert.rejects(
    () =>
      capability.execute({
        type: "escalation.request",
        question: "posso deletar isso?",
        callbackUrl: "https://exemplo.com/callback",
      }),
    /precisam ser informados JUNTOS/,
  );
});

test("escalation.request: callbackSecret sem callbackUrl é rejeitado", async () => {
  await assert.rejects(
    () =>
      capability.execute({
        type: "escalation.request",
        question: "posso deletar isso?",
        callbackSecret: "segredo-com-16-chars-ok",
      }),
    /precisam ser informados JUNTOS/,
  );
});

test("escalation.request: sem callback, cria pendente sem chamar deliverWebhookFn", async () => {
  const result = await capability.execute({
    type: "escalation.request",
    question: "posso deletar o arquivo X?",
    context: { arquivo: "X" },
  });

  assert.equal(result.status, "pending");
  assert.equal(result.question, "posso deletar o arquivo X?");
  assert.deepEqual(result.context, { arquivo: "X" });
  assert.equal(result.webhookDelivery, null);
  assert.ok(result.id);
  assert.equal(deliverWebhookCalls.length, 0);
});

test("escalation.request: com callback, dispara o webhook com o payload certo", async () => {
  const result = await capability.execute({
    type: "escalation.request",
    question: "posso fazer deploy em produção agora?",
    context: { ambiente: "producao" },
    callbackUrl: "https://exemplo.com/callback",
    callbackSecret: "segredo-com-16-chars-ok",
  });

  assert.equal(deliverWebhookCalls.length, 1);
  assert.equal(deliverWebhookCalls[0].url, "https://exemplo.com/callback");
  assert.equal(deliverWebhookCalls[0].secret, "segredo-com-16-chars-ok");
  assert.equal(deliverWebhookCalls[0].payload.escalationId, result.id);
  assert.equal(deliverWebhookCalls[0].payload.question, "posso fazer deploy em produção agora?");
  assert.deepEqual(deliverWebhookCalls[0].payload.context, { ambiente: "producao" });

  assert.equal(result.webhookDelivery.delivered, true);
  assert.equal(result.webhookDelivery.statusCode, 200);
});

test("escalation.request: deliverWebhookFn lançando inesperadamente não derruba a criação (defesa em profundidade)", async () => {
  const capabilityComFalha = new EscalationCapability({
    permissions: permissivePermissions(),
    deliverWebhookFn: async () => {
      throw new Error("erro totalmente inesperado");
    },
  });

  const result = await capabilityComFalha.execute({
    type: "escalation.request",
    question: "posso?",
    callbackUrl: "https://exemplo.com/callback",
    callbackSecret: "segredo-com-16-chars-ok",
  });

  assert.equal(result.status, "pending");
  assert.equal(result.webhookDelivery.delivered, false);
  assert.equal(result.webhookDelivery.error, "erro totalmente inesperado");
});

test("escalation.request: nunca expõe callbackSecret de volta", async () => {
  const result = await capability.execute({
    type: "escalation.request",
    question: "posso?",
    callbackUrl: "https://exemplo.com/callback",
    callbackSecret: "segredo-super-secreto-16",
  });

  assert.equal(result.callbackSecret, undefined);
  assert.ok(!JSON.stringify(result).includes("segredo-super-secreto-16"));
});

test("escalation.respond: exige escalationId", async () => {
  await assert.rejects(
    () => capability.execute({ type: "escalation.respond", decision: "aprovado" }),
    /exige escalationId/,
  );
});

test("escalation.respond: escalationId desconhecido lança erro claro", async () => {
  await assert.rejects(
    () =>
      capability.execute({
        type: "escalation.respond",
        escalationId: "não-existe",
        decision: "aprovado",
      }),
    /Escalonamento não encontrado/,
  );
});

test("escalation.respond: exige decision", async () => {
  const created = await capability.execute({ type: "escalation.request", question: "posso?" });

  await assert.rejects(
    () => capability.execute({ type: "escalation.respond", escalationId: created.id }),
    /exige decision/,
  );
});

test("escalation.respond: caminho feliz resolve o escalonamento", async () => {
  const created = await capability.execute({
    type: "escalation.request",
    question: "posso fazer deploy?",
  });

  const responded = await capability.execute({
    type: "escalation.respond",
    escalationId: created.id,
    decision: "aprovado",
    note: "confirmado pelo time de infra",
  });

  assert.equal(responded.status, "resolved");
  assert.equal(responded.decision, "aprovado");
  assert.equal(responded.note, "confirmado pelo time de infra");
  assert.ok(responded.respondedAt);
});

test("escalation.respond: responder um escalonamento já resolvido lança erro claro", async () => {
  const created = await capability.execute({ type: "escalation.request", question: "posso?" });

  await capability.execute({
    type: "escalation.respond",
    escalationId: created.id,
    decision: "aprovado",
  });

  await assert.rejects(
    () =>
      capability.execute({
        type: "escalation.respond",
        escalationId: created.id,
        decision: "rejeitado",
      }),
    /já foi respondido/,
  );
});

test("escalation.get: exige escalationId e valida existência", async () => {
  await assert.rejects(
    () => capability.execute({ type: "escalation.get" }),
    /exige escalationId/,
  );

  await assert.rejects(
    () => capability.execute({ type: "escalation.get", escalationId: "não-existe" }),
    /Escalonamento não encontrado/,
  );
});

test("escalation.get: devolve o detalhe completo, sem callbackSecret", async () => {
  const created = await capability.execute({
    type: "escalation.request",
    question: "posso?",
    callbackUrl: "https://exemplo.com/callback",
    callbackSecret: "segredo-com-16-chars-ok",
  });

  const fetched = await capability.execute({ type: "escalation.get", escalationId: created.id });

  assert.deepEqual(fetched, created);
  assert.equal(fetched.callbackSecret, undefined);
});

test("escalation.list: sem escalonamentos devolve lista vazia", async () => {
  const result = await capability.execute({ type: "escalation.list" });

  assert.deepEqual(result, { escalations: [] });
});

test("escalation.list: resume múltiplos escalonamentos (sem context/decision completos)", async () => {
  const a = await capability.execute({ type: "escalation.request", question: "pergunta A" });
  await capability.execute({ type: "escalation.request", question: "pergunta B" });

  await capability.execute({
    type: "escalation.respond",
    escalationId: a.id,
    decision: "aprovado",
  });

  const { escalations } = await capability.execute({ type: "escalation.list" });

  assert.equal(escalations.length, 2);
  const resumoA = escalations.find((e) => e.id === a.id);
  assert.equal(resumoA.status, "resolved");
  assert.equal(resumoA.question, "pergunta A");
  assert.equal(resumoA.decision, undefined);
  assert.equal(resumoA.context, undefined);
});

test("isolamento: dois escalonamentos não interferem entre si", async () => {
  const a = await capability.execute({ type: "escalation.request", question: "A" });
  const b = await capability.execute({ type: "escalation.request", question: "B" });

  await capability.execute({ type: "escalation.respond", escalationId: a.id, decision: "sim" });

  const reloadedA = await capability.execute({ type: "escalation.get", escalationId: a.id });
  const reloadedB = await capability.execute({ type: "escalation.get", escalationId: b.id });

  assert.equal(reloadedA.status, "resolved");
  assert.equal(reloadedB.status, "pending");
});
