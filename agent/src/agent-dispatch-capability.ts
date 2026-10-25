import type { PermissionGuard } from "./capabilities/capability-types.js";

/** Delegation remains role-scoped and guarded by agent.dispatch permission. */
export interface AgentDispatchTask {
  type: string;
  targetRole?: string;
  payload?: unknown;
}
export type AgentDispatchHandler = (payload: unknown) => Promise<unknown>;
export interface AgentDispatchOptions {
  permissions: PermissionGuard;
  dispatchTargets?: Record<string, AgentDispatchHandler>;
}

/**
 * AgentDispatchCapability: a única "ferramenta" que o Orquestrador
 * de fato tem. Em vez de tocar em filesystem/shell/git diretamente
 * (que ele não tem permissão pra fazer — ver createOrchestratorPermissions),
 * ele delega para um sub-agente registrado, identificado por um
 * "role" (ex: "explorer", "coder_validator", "packager").
 *
 * Não conhece a lógica interna de cada sub-agente — só sabe chamar
 * a função registrada para aquele role e devolver o resultado (ou
 * erro) de forma padronizada. Isso mantém o Orquestrador desacoplado
 * de COMO cada papel é implementado (um Agent simples, um loop como
 * o CoderValidatorLoop, ou até uma chamada pura de LLM como o
 * Arquiteto).
 */
export class AgentDispatchCapability {
  declare permissions: PermissionGuard;
  declare dispatchTargets: Record<string, AgentDispatchHandler>;

  constructor({ permissions, dispatchTargets }: AgentDispatchOptions) {
    this.permissions = permissions;

    // dispatchTargets: { [role]: async (payload) => result }
    // Cada entrada é uma função assíncrona que recebe o `payload`
    // da task e retorna o que fizer sentido para aquele role (ex:
    // para "explorer", o relatório da investigação; para
    // "coder_validator", o resultado do CoderValidatorLoop).
    this.dispatchTargets = dispatchTargets || {};
  }

  /**
   * task esperado:
   * {
   *   type: "agent.dispatch",
   *   targetRole: "explorer" | "architect" | "coder_validator" | "packager" | ...,
   *   payload: <dados específicos daquele role>,
   * }
   */
  async execute(task: AgentDispatchTask) {
    this.permissions.require(task.type);

    if (!task.targetRole || typeof task.targetRole !== "string") {
      throw new Error(
        "agent.dispatch exige targetRole (string)",
      );
    }

    const handler = this.dispatchTargets[task.targetRole];

    if (typeof handler !== "function") {
      const error: Error & { code?: string } = new Error(
        `Nenhum sub-agente registrado para targetRole: ${task.targetRole}`,
      );

      error.code = "TARGET_ROLE_NOT_FOUND";

      throw error;
    }

    const startedAt = Date.now();

    // Erros do handler NÃO são engolidos aqui — propagam para quem
    // chamou Agent.execute() (o TaskRunner), que já sabe padronizar
    // isso em { ok: false, error: {...} }. Deixar o erro subir (em
    // vez de capturar e reformatar de novo aqui) evita duplicar essa
    // lógica de formatação de erro em dois lugares.
    const result = await handler(task.payload ?? {});

    return {
      targetRole: task.targetRole,
      durationMs: Date.now() - startedAt,
      result,
    };
  }
}
