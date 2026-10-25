/**
 * Each parallel dispatch works in an independent detached Git worktree.
 * These declarations do not change branch, cleanup, or merge semantics.
 */
export interface CreateWorktreeOptions {
  repoRoot: string;
  worktreesRoot: string;
  ref?: string;
}
export interface RemoveWorktreeOptions {
  repoRoot: string;
  worktreePath: string;
}
export interface CreatedWorktree {
  path: string;
}

import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Cria um git worktree novo, isolado, a partir de um ref do
 * repositório em `repoRoot` (por padrão `HEAD`) -- usado por
 * `AgentParallelDispatchCapability` pra dar a cada dispatch
 * concorrente seu próprio diretório de trabalho, sem competir por
 * arquivos/estado de índice do git com os outros dispatches rodando
 * ao mesmo tempo (ou com o workspace compartilhado original). Mesmo
 * padrão de `execa` sem `shell:true` já usado em `capabilities/git.js`.
 *
 * `--detach`: o worktree não fica atrelado a nenhuma branch nova --
 * cada dispatch paralelo é, por padrão, um escopo EFÊMERO (destruído
 * ao final via `removeWorktree`). Quem quiser persistir o resultado
 * (ex: um commit feito dentro do worktree) precisa fazer isso
 * explicitamente antes do worktree ser removido -- esta função não
 * tenta mesclar/publicar nada sozinha, por design: mesclagem
 * automática de git é decisão de negócio (pode ter conflito, exige
 * escolha de estratégia), não infraestrutura de isolamento.
 */
export async function createWorktree({ repoRoot, worktreesRoot, ref = "HEAD" }: CreateWorktreeOptions): Promise<CreatedWorktree> {
  const worktreePath = path.join(worktreesRoot, randomUUID());

  await fs.mkdir(worktreesRoot, { recursive: true });

  const result = await execa(
    "git",
    ["worktree", "add", "--detach", worktreePath, ref],
    { cwd: repoRoot, reject: false },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `git worktree add falhou: ${result.stderr || result.stdout || "erro desconhecido"}`,
    );
  }

  return { path: worktreePath };
}

/**
 * Remove um worktree criado por `createWorktree()`. `--force`:
 * descarta qualquer mudança não commitada dentro dele -- correto
 * aqui porque a remoção só acontece DEPOIS que o dispatch
 * correspondente já terminou (sucesso ou falha) e o resultado/erro já
 * foi capturado antes desta chamada (ver
 * `AgentParallelDispatchCapability._runOne`), então nada de valor fica
 * perdido silenciosamente por essa remoção.
 */
export async function removeWorktree({ repoRoot, worktreePath }: RemoveWorktreeOptions): Promise<void> {
  await execa(
    "git",
    ["worktree", "remove", "--force", worktreePath],
    { cwd: repoRoot, reject: false },
  );

  // "git worktree remove" às vezes deixa o diretório físico pra trás
  // se algo por fora do controle do git tiver escrito lá -- garante
  // que não sobra nada no disco mesmo assim (relevante em Cloud Run,
  // onde o allowance de disco é fixo por sessão, não elástico).
  await fs.rm(worktreePath, { recursive: true, force: true });
}
