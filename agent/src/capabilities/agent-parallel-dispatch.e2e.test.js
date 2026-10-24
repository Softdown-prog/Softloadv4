import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

import { Permissions } from "../security/permissions.js";
import { Workspace } from "../core/workspace.js";
import { AgentParallelDispatchCapability } from "./agent-parallel-dispatch.js";

/**
 * Teste de ponta a ponta GENUÍNO: nenhuma função de git é substituída
 * por fake (diferente de agent-parallel-dispatch.test.js, que injeta
 * `createWorktreeFn`/`removeWorktreeFn`) -- usa um repositório git
 * REAL, criado num diretório temporário, e os valores PADRÃO da
 * capability (`createWorktree`/`removeWorktree` reais, de
 * `orchestration/git-worktree-pool.js`), rodando `git worktree add`/
 * `git worktree remove` de verdade.
 *
 * Prova o que os testes com fake não conseguem provar sozinhos: que o
 * isolamento é REAL (dois dispatches concorrentes escrevendo no MESMO
 * caminho relativo não se pisam, porque cada um está num diretório
 * físico diferente) e que a limpeza é REAL (o diretório do worktree
 * de fato deixa de existir no disco depois, e `git worktree list` não
 * deixa nenhum worktree órfão pra trás).
 */
let repoRoot;
let worktreesRoot;

before(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parallel-dispatch-repo-"));
  worktreesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parallel-dispatch-worktrees-"));

  await execa("git", ["init", "-b", "main"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "teste@softload.local"], { cwd: repoRoot });
  await execa("git", ["config", "user.name", "Teste Softload"], { cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "repositório de teste\n");
  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa("git", ["commit", "-m", "commit inicial"], { cwd: repoRoot });
});

after(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
  await fs.rm(worktreesRoot, { recursive: true, force: true });
});

function buildRealCapability(dispatchTargets) {
  return new AgentParallelDispatchCapability({
    permissions: new Permissions({ mode: "full" }),
    dispatchTargets,
    workspace: new Workspace({ root: repoRoot }),
    worktreesRoot,
    // createWorktreeFn/removeWorktreeFn NÃO passados -- usa os reais.
  });
}

test("e2e: dois dispatches concorrentes isolados não se pisam (worktrees de verdade)", async () => {
  const capability = buildRealCapability({
    coder: async (payload, context) => {
      // Escreve, espera um pouco (dá tempo do outro dispatch rodar
      // NO MEIO, se estivessem compartilhando o mesmo diretório --
      // é exatamente essa janela que provaria a colisão se o
      // isolamento não funcionasse de verdade) e lê de volta.
      await context.workspace.write("saida.txt", payload.conteudo);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const lido = await context.workspace.read("saida.txt");
      return { lido };
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [
      { targetRole: "coder", payload: { conteudo: "conteúdo do dispatch A" } },
      { targetRole: "coder", payload: { conteudo: "conteúdo do dispatch B" } },
    ],
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok));

  // Cada um leu exatamente o que ELE escreveu -- se estivessem no
  // mesmo diretório, o `read` de ambos (depois do delay) devolveria o
  // valor do ÚLTIMO a escrever, igual pros dois.
  assert.equal(results[0].result.lido, "conteúdo do dispatch A");
  assert.equal(results[1].result.lido, "conteúdo do dispatch B");

  // Worktrees físicos diferentes.
  assert.notEqual(results[0].workspaceRoot, results[1].workspaceRoot);
  assert.ok(results[0].workspaceRoot.startsWith(worktreesRoot));
  assert.ok(results[1].workspaceRoot.startsWith(worktreesRoot));

  // Limpeza real: os diretórios não existem mais no disco.
  for (const result of results) {
    await assert.rejects(() => fs.access(result.workspaceRoot));
  }

  // git worktree list não deixa nenhum worktree órfão pra trás (só o
  // principal, o próprio repoRoot).
  const listagem = await execa("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
  const worktreePaths = listagem.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.replace("worktree ", ""));

  assert.equal(worktreePaths.length, 1);
});

test("e2e: isolateWorkspace:false compartilha o repositório principal de verdade", async () => {
  const capability = buildRealCapability({
    leitor: async (_payload, context) => {
      const conteudo = await context.workspace.read("README.md");
      return { conteudo };
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [{ targetRole: "leitor", isolateWorkspace: false }],
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[0].isolated, false);
  assert.equal(results[0].workspaceRoot, repoRoot);
  assert.equal(results[0].result.conteudo, "repositório de teste\n");
});

test("e2e: worktree isolado enxerga o conteúdo já commitado no repositório principal", async () => {
  const capability = buildRealCapability({
    coder: async (_payload, context) => {
      const conteudo = await context.workspace.read("README.md");
      return { conteudo };
    },
  });

  const { results } = await capability.execute({
    type: "agent.dispatch_parallel",
    dispatches: [{ targetRole: "coder" }],
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[0].result.conteudo, "repositório de teste\n");
});
