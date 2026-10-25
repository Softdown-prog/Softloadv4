import type { AgentTask, TaskRouter } from "./task-router.js";

import { createLogger } from "../utils/logger.js";
import { AgentError } from "../utils/errors.js";

/**
 * TaskRunner: executa uma task já roteada, medindo duração e
 * padronizando o formato do resultado (sucesso ou falha), de forma
 * que quem chama `execute()` nunca precisa de try/catch — o erro é
 * sempre devolvido dentro do objeto de retorno.
 */
export class TaskRunner {
  declare router: TaskRouter;
  declare logger: ReturnType<typeof createLogger>;

  constructor({ router }: { router: TaskRouter }) {
    // Nota: o Agent passa `{ router, capabilities }`, mas aqui só
    // `router` é usado — `capabilities` é ignorado (não é um bug,
    // apenas um parâmetro não utilizado nesta classe).
    this.router = router;
    this.logger = createLogger("task-runner");
  }

  /**
   * Executa uma task: resolve a capability responsável, valida que
   * ela expõe `execute()`, roda e retorna um resultado padronizado.
   */
  async execute(task: AgentTask) {
    // Marca o início para calcular a duração total da execução.
    const startedAt = Date.now();

    // Resolve qual capability deve tratar esta task. Pode lançar
    // AgentError (ex: task inválida, tipo desconhecido, capability
    // não carregada) — esse erro propaga para fora de execute(),
    // diferente das falhas que ocorrem depois (essas são capturadas
    // no try/catch abaixo).
    const route = this.router.resolve(task);

    this.logger.info("Executando tarefa", {
      type: task.type,
      capability: route.capabilityName,
    });

    // Validação defensiva: garante que a capability resolvida
    // realmente implementa o método `execute`, evitando um erro
    // menos claro ("execute is not a function") mais adiante.
    if (typeof route.capability.execute !== "function") {
      throw new AgentError(
        `Capability ${route.capabilityName} não possui execute()`,
      );
    }

    try {
      // Delega a execução real para a capability correspondente.
      const result = await route.capability.execute(task);

      // Formato padronizado de sucesso.
      return {
        ok: true,
        taskType: task.type,
        capability: route.capabilityName,
        durationMs: Date.now() - startedAt,
        result,
      };
    } catch (error) {
      // Qualquer erro lançado pela capability durante a execução é
      // capturado aqui — não propaga para quem chamou `execute()`.
      this.logger.error("Tarefa falhou", {
        type: task.type,
        error: (error as Error).message,
      });

      // Formato padronizado de falha. Usa `error.code` se existir
      // (ex: erros customizados como AgentError podem definir um
      // código), com fallback genérico "TASK_FAILED".
      return {
        ok: false,
        taskType: task.type,
        capability: route.capabilityName,
        durationMs: Date.now() - startedAt,
        error: {
          message: (error as Error).message,
          code: (error as Error & { code?: string }).code || "TASK_FAILED",
        },
      };
    }
  }
}
