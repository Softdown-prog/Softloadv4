import { AgentError } from "../utils/errors.js";

/**
 * TASK_MAP: mapa de `task.type` -> nome da capability responsável
 * (chave usada em `Agent.capabilities`, ver agent.js). Fonte única
 * de roteamento — deve ficar em sincronia com:
 *   - os `case` de cada capability com múltiplas operações
 *     (filesystem.js, git.js);
 *   - DEFAULT_PERMISSIONS (security/permissions.js), que precisa
 *     conhecer os mesmos tipos para poder autorizar/negar cada um;
 *   - TASK_TYPE_PREFIX (protocol/protocol-adapter.js), que gera
 *     esses mesmos valores de `type` a partir de
 *     `{capability, operation}` do protocolo externo.
 *
 * Nota sobre "artifact" vs "artifacts": a capability se chama
 * `artifacts` (plural, mesmo nome do arquivo/classe), mas o prefixo
 * de `task.type` é o singular `artifact` (`artifact.build`,
 * `artifact.push`, `artifact.list`) — mantido assim porque já é o
 * valor usado por DEFAULT_PERMISSIONS e por TASK_TYPE_PREFIX.
 *
 * "agent.dispatch" não tem operação separada: é tratado como um
 * `task.type` só, roteado para a capability extra de chave
 * "dispatch" (AgentDispatchCapability, adicionada via
 * `options.extraCapabilities` — ver agent.js). Não faz parte do
 * protocolo HTTP externo (protocol.js só valida as 6 capabilities
 * padrão); é usado só internamente pelo Orquestrador.
 *
 * "agent.dispatch_parallel" segue o mesmo critério (capability extra
 * de chave "dispatchParallel", AgentParallelDispatchCapability, fora
 * do protocolo HTTP externo) — é o fan-out de "agent.dispatch": roda
 * vários dispatches em paralelo, cada um isolado em seu próprio git
 * worktree por padrão (ver capabilities/agent-parallel-dispatch.js).
 *
 * "plan.*" também segue o mesmo critério (capability extra de chave
 * "planTracker", PlanTrackerCapability, fora do protocolo HTTP
 * externo) — registro EM MEMÓRIA de progresso de uma tarefa de vários
 * passos, só pro Orquestrador (ver capabilities/plan-tracker.js).
 */
const TASK_MAP = {
  "forge.catalog": "forge",
  "forge.recipe": "forge",
  "forge.render": "forge",
  "file.read": "filesystem",
  "file.write": "filesystem",
  "file.edit": "filesystem",
  "file.diff": "filesystem",
  "file.patch": "filesystem",
  "file.delete": "filesystem",
  "file.list": "filesystem",
  "file.search": "filesystem",

  "shell.execute": "shell",

  "git.status": "git",
  "git.diff": "git",
  "git.log": "git",
  "git.branch": "git",
  "git.commit": "git",

  "github.issue_create": "github",
  "github.issue_get": "github",
  "github.pull_request_create": "github",
  "github.pull_request_get": "github",
  "github.repository_get": "github",

  "storage.read": "storage",
  "storage.write": "storage",
  "storage.delete": "storage",
  "storage.list": "storage",

  "artifact.build": "artifacts",
  "artifact.push": "artifacts",
  "artifact.list": "artifacts",

  "build.detect": "build",
  "build.run": "build",

  "test.detect": "test",
  "test.run": "test",

  "package.install": "package",
  "package.add": "package",

  "process.start": "process",
  "process.status": "process",
  "process.output": "process",
  "process.kill": "process",

  "code.analyze": "codeAnalysis",
  "code.search": "codeSearch",

  "project.inspect": "projectInspector",

  "web.search": "webSearch",
  "web.fetch": "webFetch",

  "escalation.request": "escalation",
  "escalation.respond": "escalation",
  "escalation.get": "escalation",
  "escalation.list": "escalation",


  "knowledge.search": "knowledgeSearch",

  "mcp.list_servers": "mcp",
  "mcp.list_tools": "mcp",
  "mcp.call_tool": "mcp",

  "agent.dispatch": "dispatch",
  "agent.dispatch_parallel": "dispatchParallel",

  "plan.create": "planTracker",
  "plan.add_item": "planTracker",
  "plan.update_item": "planTracker",
  "plan.list": "planTracker",
  "plan.get": "planTracker",
};

/**
 * TaskRouter: decide qual capability deve tratar uma task, com base
 * em `task.type` e no TASK_MAP acima.
 *
 * Responsabilidade única: roteamento. NÃO verifica permissões — cada
 * capability já checa `permissions.require(task.type)` no início do
 * seu próprio `execute()` (ver filesystem.js, git.js, shell.js,
 * etc.), então duplicar a checagem aqui só espalharia a mesma regra
 * em dois lugares sem necessidade.
 */
export class TaskRouter {
  constructor({ capabilities }) {
    this.capabilities = capabilities;
  }

  /**
   * Resolve `task.type` para `{ capabilityName, capability }`.
   * Lança AgentError (nunca retorna algo inválido) quando:
   *   - a task não tem `type` (string);
   *   - `type` não está no TASK_MAP (tipo desconhecido);
   *   - a capability mapeada não foi carregada neste agent (ex:
   *     "agent.dispatch" roteado num agent que não recebeu a
   *     AgentDispatchCapability via `extraCapabilities`).
   */
  resolve(task) {
    if (!task || typeof task.type !== "string" || task.type.length === 0) {
      throw new AgentError(
        "Task inválida: campo 'type' (string não vazia) é obrigatório",
        "TASK_TYPE_MISSING",
      );
    }

    const capabilityName = TASK_MAP[task.type];

    if (!capabilityName) {
      throw new AgentError(
        `Tipo de task desconhecido: ${task.type}`,
        "UNKNOWN_TASK_TYPE",
      );
    }

    const capability = this.capabilities[capabilityName];

    if (!capability) {
      throw new AgentError(
        `Nenhuma capability encontrada para: ${capabilityName} (task.type: ${task.type})`,
        "CAPABILITY_NOT_LOADED",
      );
    }

    return { capabilityName, capability };
  }
}

