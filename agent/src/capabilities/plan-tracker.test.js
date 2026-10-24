import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Permissions } from "../security/permissions.js";
import { PlanTrackerCapability } from "./plan-tracker.js";

function permissivePermissions() {
  return new Permissions({
    permissions: {
      "plan.create": true,
      "plan.add_item": true,
      "plan.update_item": true,
      "plan.list": true,
      "plan.get": true,
    },
  });
}

let capability;

beforeEach(() => {
  capability = new PlanTrackerCapability({ permissions: permissivePermissions() });
});

test("execute: nega ação sem permissão (fail-closed)", async () => {
  const restricted = new PlanTrackerCapability({
    permissions: new Permissions({ permissions: { "plan.create": false } }),
  });

  await assert.rejects(
    () => restricted.execute({ type: "plan.create", title: "x" }),
    /Permissão negada/,
  );
});

test("execute: tipo de task desconhecido lança erro (mode full)", async () => {
  const full = new PlanTrackerCapability({ permissions: new Permissions({ mode: "full" }) });

  await assert.rejects(
    () => full.execute({ type: "plan.algo_inventado" }),
    /Operação plan-tracker desconhecida/,
  );
});

test("plan.create: exige title", async () => {
  await assert.rejects(
    () => capability.execute({ type: "plan.create" }),
    /exige title/,
  );
});

test("plan.create: sem items cria plano vazio", async () => {
  const plan = await capability.execute({ type: "plan.create", title: "Migração de nicho" });

  assert.equal(plan.title, "Migração de nicho");
  assert.equal(plan.description, null);
  assert.deepEqual(plan.items, []);
  assert.ok(plan.id);
  assert.ok(plan.createdAt);
  assert.equal(plan.createdAt, plan.updatedAt);
});

test("plan.create: com items cria cada item como pending, com id único", async () => {
  const plan = await capability.execute({
    type: "plan.create",
    title: "Compilação",
    description: "Rodar o pipeline completo",
    items: [{ description: "extrair peças" }, { description: "validar dossiê" }],
  });

  assert.equal(plan.items.length, 2);
  assert.ok(plan.items.every((item) => item.status === "pending"));
  assert.notEqual(plan.items[0].id, plan.items[1].id);
  assert.equal(plan.items[0].description, "extrair peças");
  assert.equal(plan.items[1].description, "validar dossiê");
});

test("plan.create: items que não é array lança erro", async () => {
  await assert.rejects(
    () => capability.execute({ type: "plan.create", title: "x", items: "não é array" }),
    /items, se informado, deve ser um array/,
  );
});

test("plan.create: item sem description lança erro", async () => {
  await assert.rejects(
    () => capability.execute({ type: "plan.create", title: "x", items: [{}] }),
    /exige description/,
  );
});

test("plan.add_item: exige planId", async () => {
  await assert.rejects(
    () => capability.execute({ type: "plan.add_item", description: "x" }),
    /exige planId/,
  );
});

test("plan.add_item: plano inexistente lança erro claro", async () => {
  await assert.rejects(
    () => capability.execute({ type: "plan.add_item", planId: "não-existe", description: "x" }),
    /Plano não encontrado/,
  );
});

test("plan.add_item: exige description", async () => {
  const plan = await capability.execute({ type: "plan.create", title: "x" });

  await assert.rejects(
    () => capability.execute({ type: "plan.add_item", planId: plan.id }),
    /exige description/,
  );
});

test("plan.add_item: adiciona item pending e atualiza updatedAt do plano", async () => {
  const plan = await capability.execute({ type: "plan.create", title: "x" });
  const originalUpdatedAt = plan.updatedAt;

  await new Promise((resolve) => setTimeout(resolve, 5));

  const { item } = await capability.execute({
    type: "plan.add_item",
    planId: plan.id,
    description: "novo passo descoberto no meio do trabalho",
  });

  assert.equal(item.status, "pending");
  assert.equal(item.description, "novo passo descoberto no meio do trabalho");

  const reloaded = await capability.execute({ type: "plan.get", planId: plan.id });
  assert.equal(reloaded.items.length, 1);
  assert.ok(reloaded.updatedAt >= originalUpdatedAt);
});

test("plan.update_item: exige planId e itemId", async () => {
  await assert.rejects(
    () => capability.execute({ type: "plan.update_item" }),
    /exige planId/,
  );

  const plan = await capability.execute({ type: "plan.create", title: "x" });

  await assert.rejects(
    () => capability.execute({ type: "plan.update_item", planId: plan.id }),
    /exige itemId/,
  );
});

test("plan.update_item: item inexistente lança erro claro", async () => {
  const plan = await capability.execute({ type: "plan.create", title: "x" });

  await assert.rejects(
    () =>
      capability.execute({
        type: "plan.update_item",
        planId: plan.id,
        itemId: "não-existe",
        status: "completed",
      }),
    /Item não encontrado/,
  );
});

test("plan.update_item: status inválido lança erro claro", async () => {
  const plan = await capability.execute({
    type: "plan.create",
    title: "x",
    items: [{ description: "passo 1" }],
  });

  await assert.rejects(
    () =>
      capability.execute({
        type: "plan.update_item",
        planId: plan.id,
        itemId: plan.items[0].id,
        status: "status_inventado",
      }),
    /status inválido/,
  );
});

test("plan.update_item: atualiza status, description e note", async () => {
  const plan = await capability.execute({
    type: "plan.create",
    title: "x",
    items: [{ description: "passo 1" }],
  });
  const itemId = plan.items[0].id;

  const result = await capability.execute({
    type: "plan.update_item",
    planId: plan.id,
    itemId,
    status: "in_progress",
    note: "começou às 10h",
  });

  assert.equal(result.deleted, false);
  assert.equal(result.item.status, "in_progress");
  assert.equal(result.item.note, "começou às 10h");
  assert.equal(result.item.description, "passo 1");

  const result2 = await capability.execute({
    type: "plan.update_item",
    planId: plan.id,
    itemId,
    status: "completed",
    description: "passo 1 (renomeado)",
  });

  assert.equal(result2.item.status, "completed");
  assert.equal(result2.item.description, "passo 1 (renomeado)");
  // note não foi reenviado -- deve permanecer o valor anterior.
  assert.equal(result2.item.note, "começou às 10h");
});

test("plan.update_item: description vazia é rejeitada", async () => {
  const plan = await capability.execute({
    type: "plan.create",
    title: "x",
    items: [{ description: "passo 1" }],
  });

  await assert.rejects(
    () =>
      capability.execute({
        type: "plan.update_item",
        planId: plan.id,
        itemId: plan.items[0].id,
        description: "   ",
      }),
    /não pode ser vazia/,
  );
});

test("plan.update_item: status \"deleted\" remove o item de verdade", async () => {
  const plan = await capability.execute({
    type: "plan.create",
    title: "x",
    items: [{ description: "passo 1" }, { description: "passo 2" }],
  });
  const [item1, item2] = plan.items;

  const result = await capability.execute({
    type: "plan.update_item",
    planId: plan.id,
    itemId: item1.id,
    status: "deleted",
  });

  assert.equal(result.deleted, true);
  assert.equal(result.item.id, item1.id);

  const reloaded = await capability.execute({ type: "plan.get", planId: plan.id });
  assert.equal(reloaded.items.length, 1);
  assert.equal(reloaded.items[0].id, item2.id);
});

test("plan.list: sem planos devolve lista vazia", async () => {
  const result = await capability.execute({ type: "plan.list" });

  assert.deepEqual(result, { plans: [] });
});

test("plan.list: resume múltiplos planos com contagem por status", async () => {
  const planA = await capability.execute({
    type: "plan.create",
    title: "Plano A",
    items: [{ description: "1" }, { description: "2" }, { description: "3" }],
  });

  await capability.execute({
    type: "plan.update_item",
    planId: planA.id,
    itemId: planA.items[0].id,
    status: "completed",
  });

  await capability.execute({
    type: "plan.update_item",
    planId: planA.id,
    itemId: planA.items[1].id,
    status: "in_progress",
  });

  await capability.execute({ type: "plan.create", title: "Plano B" });

  const { plans } = await capability.execute({ type: "plan.list" });

  assert.equal(plans.length, 2);

  const resumoA = plans.find((p) => p.id === planA.id);
  assert.equal(resumoA.title, "Plano A");
  assert.equal(resumoA.totalItems, 3);
  assert.deepEqual(resumoA.itemCounts, { pending: 1, in_progress: 1, completed: 1 });
  assert.equal(resumoA.items, undefined); // list() é resumo, não detalhe completo
});

test("plan.get: exige planId e valida existência", async () => {
  await assert.rejects(
    () => capability.execute({ type: "plan.get" }),
    /exige planId/,
  );

  await assert.rejects(
    () => capability.execute({ type: "plan.get", planId: "não-existe" }),
    /Plano não encontrado/,
  );
});

test("plan.get: devolve o plano completo, com todos os items", async () => {
  const created = await capability.execute({
    type: "plan.create",
    title: "x",
    items: [{ description: "passo 1" }],
  });

  const fetched = await capability.execute({ type: "plan.get", planId: created.id });

  assert.deepEqual(fetched, created);
});

test("isolamento: dois planos não interferem entre si", async () => {
  const planA = await capability.execute({
    type: "plan.create",
    title: "A",
    items: [{ description: "a1" }],
  });
  const planB = await capability.execute({
    type: "plan.create",
    title: "B",
    items: [{ description: "b1" }],
  });

  await capability.execute({
    type: "plan.update_item",
    planId: planA.id,
    itemId: planA.items[0].id,
    status: "completed",
  });

  const reloadedA = await capability.execute({ type: "plan.get", planId: planA.id });
  const reloadedB = await capability.execute({ type: "plan.get", planId: planB.id });

  assert.equal(reloadedA.items[0].status, "completed");
  assert.equal(reloadedB.items[0].status, "pending");
});
