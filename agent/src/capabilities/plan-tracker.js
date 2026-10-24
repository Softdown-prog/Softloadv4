import { randomUUID } from "node:crypto";

const VALID_STATUSES = new Set(["pending", "in_progress", "completed", "deleted"]);

/**
 * PlanTrackerCapability: registro EM MEMÓRIA de "o que já foi feito,
 * o que está pendente" numa tarefa de vários passos — equivalente ao
 * TaskCreate/TaskUpdate/TaskList deste próprio Claude Code.
 *
 * Decisão de armazenamento (confirmada com o usuário antes de
 * implementar): em memória, escopado à vida do processo/instância
 * desta capability — mesmo comportamento OBSERVÁVEL do meu próprio
 * TaskList (efêmero, não sobrevive a troca de sessão). Sem
 * dependência nova, sem chamada de rede a cada atualização de
 * progresso. Não sobrevive a um restart do container Cloud Run no
 * meio de uma orquestração — aceito conscientemente, documentado, não
 * escondido (mesmo padrão de outras limitações já documentadas neste
 * repositório, ex: TOCTOU em proteções de SSRF).
 *
 * Terminologia deliberadamente "plan"/"item", não "task" — "task" já
 * tem um significado MUITO específico e onipresente neste codebase
 * (task.type, TaskRouter, TaskRunner, Agent.execute(task)); reusar a
 * palavra aqui criaria duas coisas diferentes com o mesmo nome no
 * mesmo sistema.
 *
 * Assim como AgentDispatchCapability/AgentParallelDispatchCapability,
 * não faz parte do protocolo HTTP externo — só o Orquestrador recebe
 * isto, via `extraCapabilities` (ver orchestration/orchestrator-example.js).
 * Sub-agentes (Investigador, Programador, Validador, Empacotador) não
 * têm motivo pra tocar o plano diretamente: é o Orquestrador quem
 * inspeciona o resultado de cada dispatch e decide como isso reflete
 * no progresso.
 */
export class PlanTrackerCapability {
  constructor({ permissions } = {}) {
    this.permissions = permissions;
    this.plans = new Map();
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "plan.create":
        return this.create(task);

      case "plan.add_item":
        return this.addItem(task);

      case "plan.update_item":
        return this.updateItem(task);

      case "plan.list":
        return this.list();

      case "plan.get":
        return this.get(task);

      default:
        throw new Error(`Operação plan-tracker desconhecida: ${task.type}`);
    }
  }

  _requirePlan(planId, taskType) {
    if (typeof planId !== "string" || planId.trim() === "") {
      throw new Error(`${taskType} exige planId (string)`);
    }

    const plan = this.plans.get(planId);

    if (!plan) {
      throw new Error(`Plano não encontrado: ${planId}`);
    }

    return plan;
  }

  _buildItem(description) {
    if (typeof description !== "string" || description.trim() === "") {
      throw new Error("item de plano exige description (string não vazia)");
    }

    const now = Date.now();

    return {
      id: randomUUID(),
      description,
      status: "pending",
      note: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  create(task) {
    if (typeof task.title !== "string" || task.title.trim() === "") {
      throw new Error("plan.create exige title (string não vazia)");
    }

    if (task.items !== undefined && !Array.isArray(task.items)) {
      throw new Error("plan.create: items, se informado, deve ser um array");
    }

    const now = Date.now();

    const plan = {
      id: randomUUID(),
      title: task.title,
      description: task.description ?? null,
      items: (task.items || []).map((item) => this._buildItem(item.description)),
      createdAt: now,
      updatedAt: now,
    };

    this.plans.set(plan.id, plan);

    return plan;
  }

  addItem(task) {
    const plan = this._requirePlan(task.planId, "plan.add_item");

    const item = this._buildItem(task.description);

    plan.items.push(item);
    plan.updatedAt = Date.now();

    return { planId: plan.id, item };
  }

  /**
   * Atualiza um item existente. `status: "deleted"` REMOVE o item da
   * lista (não é um estado visível, é um comando) — mesmo contrato do
   * meu próprio TaskUpdate ("Setting status to `deleted` permanently
   * removes the task").
   */
  updateItem(task) {
    const plan = this._requirePlan(task.planId, "plan.update_item");

    if (typeof task.itemId !== "string" || task.itemId.trim() === "") {
      throw new Error("plan.update_item exige itemId (string)");
    }

    const index = plan.items.findIndex((item) => item.id === task.itemId);

    if (index === -1) {
      throw new Error(`Item não encontrado no plano ${plan.id}: ${task.itemId}`);
    }

    if (task.status !== undefined && !VALID_STATUSES.has(task.status)) {
      throw new Error(
        `plan.update_item: status inválido "${task.status}" (esperado: ${[...VALID_STATUSES].join(", ")})`,
      );
    }

    if (task.status === "deleted") {
      const [removed] = plan.items.splice(index, 1);
      plan.updatedAt = Date.now();
      return { planId: plan.id, deleted: true, item: removed };
    }

    const item = plan.items[index];

    if (task.status !== undefined) {
      item.status = task.status;
    }

    if (task.description !== undefined) {
      if (typeof task.description !== "string" || task.description.trim() === "") {
        throw new Error("plan.update_item: description, se informada, não pode ser vazia");
      }
      item.description = task.description;
    }

    if (task.note !== undefined) {
      item.note = task.note;
    }

    item.updatedAt = Date.now();
    plan.updatedAt = Date.now();

    return { planId: plan.id, deleted: false, item };
  }

  /**
   * Lista todos os planos conhecidos, em formato resumido (contagem
   * de itens por status, não os itens completos — ver plan.get pra
   * isso) — mesmo espírito do meu próprio TaskList, que devolve um
   * resumo por task, não o detalhe completo.
   */
  list() {
    return {
      plans: [...this.plans.values()].map((plan) => this._summarize(plan)),
    };
  }

  get(task) {
    const plan = this._requirePlan(task.planId, "plan.get");

    return plan;
  }

  _summarize(plan) {
    const counts = { pending: 0, in_progress: 0, completed: 0 };

    for (const item of plan.items) {
      if (counts[item.status] !== undefined) {
        counts[item.status] += 1;
      }
    }

    return {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      itemCounts: counts,
      totalItems: plan.items.length,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }
}
