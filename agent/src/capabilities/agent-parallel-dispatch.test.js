import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Permissions } from "../security/permissions.js";
import { Workspace } from "../core/workspace.js";
import { AgentParallelDispatchCapability } from "./agent-parallel-dispatch.js";

// Todos os testes aqui usam createWorktreeFn/removeWorktreeFn
// injetados -- nenhum bate em git real. O teste de ponta a ponta
// genuíno (repositório git real, worktrees reais, escrita concorrente
// de arquivos) mora em agent-parallel-dispatch.e2e.test.js.

function permissivePermissions() {
  return new Permissions({ permissions: { "agent.dispatch_parallel": true } });
}

function buildFakeWorktreeFns() {
  const created = [];
  const removed = [];
  let counter = 0;

  const createWorktreeFn = async ({ repoRoot, worktreesRoot }) => {
    counter += 1;
    const worktreePath = `${worktreesRoot}/fake-worktree-${counter}`;
    created.push({ repoRoot, worktreesRoot, worktreePath });
    return { path: worktreePath };
  };

  const removeWorktreeFn = async ({ repoRoot, worktreePath }) => {
    removed.push({ repoRoot, worktreePath });
    await rm(worktreePath, { recursive: true, force: true });
  };

  return { createWorktreeFn, removeWorktreeFn, created, removed };
}

function buildCapability({
  dispatchTargets,
  workspace,
  permissions,
  createWorktreeFn,
  removeWorktreeFn,
} = {}) {
  const fakes = buildFakeWorktreeFns();

  return {
    capability: new AgentParallelDispatchCapability({
      permissions: permissions || permissivePermissions(),
      dispatchTargets: dispatchTargets || {},
      workspace: workspace !== undefined ? workspace : new Workspace({ root: "/workspace" }),
      // The unit test must run without root privileges (e.g. GitHub Actions).
      // Keep production defaults untouched: only the injected test root changes.
      worktreesRoot: path.join(os.tmpdir(), `softload-agent-worktrees-${process.pid}`),
      createWorktreeFn: createWorktreeFn || fakes.createWorktreeFn,
      removeWorktreeFn: removeWorktreeFn || fakes.removeWorktreeFn,
    }),
    ...fakes,
  };
}

test("execute: nega ação sem permissão (fail-closed)", async () => {
  const { capability } = buildCapability({
    permissions: new Permissions({ permissions: { "agent.dispatch_parallel": false } }),
  });

  await assert.rejects(
    () => capability.execute({ type: "agent.dispatch_parallel", dispatches: [] }),
    /Permissão negada/,
  );
});

test("execute: tipo de task desconhecido lança erro (mode full pra passar da checagem de permissão)", async () => {
  const { capability } = buildCapability({
    permissions: new Permissions({ mode: "full" }),
  });

  await assert.rejects(
    () => capability.execute({ type: "agent.dispatch_parallel.algo_inventado" }),
    /Operação agent-parallel-dispatch desconhecida/,
  );
});

test("dispatch_parallel: exige dispatches (array não vazio)", async () => {
  const { capability } = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "agent.dispatch_parallel" }),
    /exige dispatches/,
  );

  await assert.rejects(
    () => capability.execute({ type: "agent.dispatch_parallel", dispatches: [] }),
    /exige dispatches/,
  );
});

test("dispatch_parallel: rejeita lote acima do teto máximo", async () => {
  const { capability } = buildCapability();

  const dispatches = Array.from({ length: 21 }, () => ({ targetRole: "x" }));

  await assert.rejects(
    () => capability.execute({ type: "agent.dispatch_parallel", dispatches }),
    /no máximo 20 dispatches/,
  );
});

test("dispatch_parallel: dispatches[i] sem targetRole lança erro com índice", async () => {
  const { capability } = buildCapability();

  await assert.rejects(
    () =>
      capability.execute({
        type: "agent.dispatch_parallel",
        dispatches: [{ targetRole: "explorer" }, { payload: {} }],
      }),
    /dispatches\[1\] exige targetRole/,
  );
});

test("dispatch_parallel: targetRole desconhecido vira falha isolada (não aborta o lote)", async () => {
  const { capability } = buildCapability({
    dispatchTargets: {
      explorer: async () => ({ ok: true }),
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [
      { targetRole: "explorer", isolateWorkspace: false },
      { targetRole: "role_que_nao_existe", isolateWorkspace: false },
    ],
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error.code, "TARGET_ROLE_NOT_FOUND");
});

test("dispatch_parallel: caminho feliz isolado -- cria worktree, passa context, limpa depois", async () => {
  const { capability, created, removed } = buildCapability({
    dispatchTargets: {
      coder: async (payload, context) => {
        return { recebeuPayload: payload, workspaceRoot: context.workspaceRoot, isolated: context.isolated };
      },
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [{ targetRole: "coder", payload: { arquivo: "a.js" } }],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].isolated, true);
  assert.equal(results[0].result.recebeuPayload.arquivo, "a.js");
  assert.equal(results[0].result.isolated, true);
  assert.equal(results[0].result.workspaceRoot, results[0].workspaceRoot);

  assert.equal(created.length, 1);
  assert.equal(created[0].repoRoot, "/workspace");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].worktreePath, created[0].worktreePath);
});

test("dispatch_parallel: isolateWorkspace:false usa o workspace compartilhado direto, sem worktree", async () => {
  const sharedWorkspace = new Workspace({ root: "/workspace" });

  const { capability, created, removed } = buildCapability({
    workspace: sharedWorkspace,
    dispatchTargets: {
      architect: async (payload, context) => context,
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [{ targetRole: "architect", isolateWorkspace: false }],
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[0].isolated, false);
  assert.equal(results[0].result.workspaceRoot, "/workspace");
  assert.equal(created.length, 0);
  assert.equal(removed.length, 0);
});

test("dispatch_parallel: isolamento pedido sem workspace compartilhado configurado -> falha isolada clara", async () => {
  const { capability } = buildCapability({
    workspace: null,
    dispatchTargets: { coder: async () => ({}) },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [{ targetRole: "coder" }],
  });

  assert.equal(results[0].ok, false);
  assert.ok(results[0].error.message.includes("nenhum workspace compartilhado"));
});

test("dispatch_parallel: falha do handler não impede a limpeza do worktree", async () => {
  const { capability, created, removed } = buildCapability({
    dispatchTargets: {
      coder: async () => {
        throw new Error("o handler quebrou de propósito");
      },
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [{ targetRole: "coder" }],
  });

  assert.equal(results[0].ok, false);
  assert.equal(results[0].error.message, "o handler quebrou de propósito");
  assert.equal(created.length, 1);
  assert.equal(removed.length, 1);
});

test("dispatch_parallel: falha ao criar worktree vira falha isolada, sem tentar remover (nada foi criado)", async () => {
  const { capability, removed } = buildCapability({
    dispatchTargets: { coder: async () => ({}) },
    createWorktreeFn: async () => {
      throw new Error("git worktree add falhou: fatal: not a git repository");
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [{ targetRole: "coder" }],
  });

  assert.equal(results[0].ok, false);
  assert.ok(results[0].error.message.includes("not a git repository"));
  assert.equal(removed.length, 0);
});

test("dispatch_parallel: resultados mantêm a ordem original mesmo com durações diferentes", async () => {
  const { capability } = buildCapability({
    dispatchTargets: {
      rapido: async () => "rapido",
      lento: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return "lento";
      },
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [
      { targetRole: "lento", isolateWorkspace: false },
      { targetRole: "rapido", isolateWorkspace: false },
      { targetRole: "lento", isolateWorkspace: false },
    ],
  });

  assert.deepEqual(
    results.map((r) => r.targetRole),
    ["lento", "rapido", "lento"],
  );
  assert.deepEqual(
    results.map((r) => r.result),
    ["lento", "rapido", "lento"],
  );
});

test("dispatch_parallel: respeita o limite de concorrência configurado", async () => {
  let active = 0;
  let maxActive = 0;

  const { capability } = buildCapability({
    dispatchTargets: {
      trabalho: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return "ok";
      },
    },
  });

  const dispatches = Array.from({ length: 6 }, () => ({
    targetRole: "trabalho",
    isolateWorkspace: false,
  }));

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches,
    concurrency: 2,
  });

  assert.equal(results.length, 6);
  assert.ok(results.every((r) => r.ok));
  assert.equal(maxActive, 2);
});

test("dispatch_parallel: concurrency acima do teto rígido é limitado ao teto", async () => {
  let maxActive = 0;
  let active = 0;

  const { capability } = buildCapability({
    dispatchTargets: {
      trabalho: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return "ok";
      },
    },
  });

  const dispatches = Array.from({ length: 15 }, () => ({
    targetRole: "trabalho",
    isolateWorkspace: false,
  }));

  await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches,
    concurrency: 999,
  });

  assert.equal(maxActive, 10);
});
