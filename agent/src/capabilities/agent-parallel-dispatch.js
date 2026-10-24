import pLimit from "p-limit";

import { Workspace } from "../core/workspace.js";
import { createWorktree, removeWorktree } from "../orchestration/git-worktree-pool.js";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 10;
const MAX_DISPATCHES_PER_BATCH = 20;

/**
 * AgentParallelDispatchCapability: fan-out de `agent.dispatch` -- roda
 * vários dispatches (mesmo conceito de `AgentDispatchCapability`,
 * `{targetRole, payload}`) EM PARALELO, cada um isolado em seu próprio
 * git worktree por padrão, em vez de todos competirem pelo mesmo
 * diretório de trabalho.
 *
 * Deliberadamente uma capability SEPARADA de `AgentDispatchCapability`
 * (não uma extensão dela) -- `agent.dispatch` continua exatamente como
 * era (um dispatch por vez, sem isolamento, sem mudança de
 * comportamento pra quem já usa), e esta é a ferramenta nova pra quem
 * precisa rodar N sub-agentes de verdade ao mesmo tempo. Também não
 * é exposta no protocolo HTTP externo (`protocol.js`/
 * `protocol-adapter.js`), mesmo critério de `agent.dispatch` -- é uso
 * interno do Orquestrador via `Agent.execute()` direto.
 *
 * Cada handler em `dispatchTargets` (o mesmo mapa `{ [role]: async
 * (payload) => result }` já usado por `AgentDispatchCapability`)
 * passa a receber um SEGUNDO argumento opcional, `context: { workspace,
 * workspaceRoot, isolated }` -- handlers que não usam workspace (ex:
 * "architect", uma chamada de LLM pura) simplesmente ignoram esse
 * argumento extra, sem nenhuma mudança de comportamento. Handlers que
 * PRECISAM tocar arquivos/git usam `context.workspace` em vez de um
 * `Workspace` fixo capturado por closure, senão o isolamento não teria
 * efeito nenhum (ver `orchestration/orchestrator-example.js` para um
 * exemplo real de handler workspace-aware).
 *
 * `createWorktree`/`removeWorktree` são injetáveis no construtor
 * (mesmo padrão de `fetchImpl`/`ClientClass` no resto do agent/) --
 * testes de unidade nunca precisam de um repositório git real; o
 * teste de ponta a ponta usa um repositório git real (ver
 * `agent-parallel-dispatch.e2e.test.js`).
 */
export class AgentParallelDispatchCapability {
  constructor({
    permissions,
    dispatchTargets,
    workspace,
    worktreesRoot,
    createWorktreeFn = createWorktree,
    removeWorktreeFn = removeWorktree,
  } = {}) {
    this.permissions = permissions;
    this.dispatchTargets = dispatchTargets || {};
    this.workspace = workspace || null;
    this.worktreesRoot =
      worktreesRoot || (workspace ? `${workspace.root}-worktrees` : null);
    this.createWorktreeFn = createWorktreeFn;
    this.removeWorktreeFn = removeWorktreeFn;
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "agent.dispatch_parallel":
        return this.dispatchParallel(task);

      default:
        throw new Error(`Operação agent-parallel-dispatch desconhecida: ${task.type}`);
    }
  }

  async dispatchParallel(task) {
    if (!Array.isArray(task.dispatches) || task.dispatches.length === 0) {
      throw new Error("agent.dispatch_parallel exige dispatches (array não vazio)");
    }

    if (task.dispatches.length > MAX_DISPATCHES_PER_BATCH) {
      throw new Error(
        `agent.dispatch_parallel: no máximo ${MAX_DISPATCHES_PER_BATCH} dispatches por lote (recebido: ${task.dispatches.length})`,
      );
    }

    task.dispatches.forEach((dispatch, index) => {
      if (
        !dispatch ||
        typeof dispatch.targetRole !== "string" ||
        dispatch.targetRole.trim() === ""
      ) {
        throw new Error(
          `agent.dispatch_parallel: dispatches[${index}] exige targetRole (string)`,
        );
      }
    });

    const concurrency = Math.min(
      Number.isInteger(task.concurrency) && task.concurrency > 0
        ? task.concurrency
        : DEFAULT_CONCURRENCY,
      MAX_CONCURRENCY,
    );

    const limit = pLimit(concurrency);

    const results = await Promise.all(
      task.dispatches.map((dispatch, index) => limit(() => this._runOne(dispatch, index))),
    );

    return { results };
  }

  async _runOne(dispatch, index) {
    // Isolado por padrão -- fail-safe: um dispatch que NÃO pede
    // explicitamente `isolateWorkspace: false` é tratado como se
    // pudesse tocar o workspace, já que esta capability não conhece
    // (nem deveria conhecer, ver header do arquivo) o que cada
    // handler faz de verdade por dentro.
    const isolateWorkspace = dispatch.isolateWorkspace !== false;
    const startedAt = Date.now();

    let scopedWorkspace = this.workspace;
    let worktreePath = null;

    try {
      const handler = this.dispatchTargets[dispatch.targetRole];

      if (typeof handler !== "function") {
        const error = new Error(
          `Nenhum sub-agente registrado para targetRole: ${dispatch.targetRole}`,
        );
        error.code = "TARGET_ROLE_NOT_FOUND";
        throw error;
      }

      if (isolateWorkspace) {
        if (!this.workspace) {
          throw new Error(
            `agent.dispatch_parallel: dispatches[${index}] pediu isolamento de workspace, mas nenhum workspace compartilhado foi configurado nesta capability`,
          );
        }

        const worktree = await this.createWorktreeFn({
          repoRoot: this.workspace.root,
          worktreesRoot: this.worktreesRoot,
        });

        worktreePath = worktree.path;
        scopedWorkspace = new Workspace({ root: worktreePath });
        await scopedWorkspace.initialize();
      }

      const result = await handler(dispatch.payload ?? {}, {
        workspace: scopedWorkspace,
        workspaceRoot: scopedWorkspace ? scopedWorkspace.root : null,
        isolated: isolateWorkspace,
      });

      return {
        index,
        targetRole: dispatch.targetRole,
        ok: true,
        isolated: isolateWorkspace,
        workspaceRoot: scopedWorkspace ? scopedWorkspace.root : null,
        durationMs: Date.now() - startedAt,
        result,
      };
    } catch (error) {
      return {
        index,
        targetRole: dispatch.targetRole,
        ok: false,
        isolated: isolateWorkspace,
        workspaceRoot: scopedWorkspace ? scopedWorkspace.root : null,
        durationMs: Date.now() - startedAt,
        error: { message: error.message, code: error.code || null },
      };
    } finally {
      if (worktreePath) {
        await this.removeWorktreeFn({
          repoRoot: this.workspace.root,
          worktreePath,
        }).catch(() => {
          // Falha ao limpar não deveria mascarar o resultado real do
          // dispatch (já capturado acima) -- mesmo critério de
          // `client.close().catch(() => {})` em mcp-client.js.
        });
      }
    }
  }
}
