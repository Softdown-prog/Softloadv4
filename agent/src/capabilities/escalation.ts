import type { PermissionGuard } from "./capability-types.js";

export interface EscalationTask {
  type: string;
  escalationId?: string;
  question?: string;
  context?: unknown;
  callbackUrl?: string;
  callbackSecret?: string;
  decision?: string;
  note?: unknown;
}

export interface EscalationRecord {
  id: string;
  question: string;
  context: unknown;
  status: "pending" | "resolved";
  decision: string | null;
  note: unknown;
  callbackUrl: string | null;
  callbackSecret: string | null;
  webhookDelivery: unknown;
  createdAt: number;
  updatedAt: number;
  respondedAt: number | null;
}

type WebhookFn = (args: {
  url: string;
  secret: string | null;
  payload: Record<string, unknown>;
}) => Promise<unknown>;

import { randomUUID } from "node:crypto";
import { deliverWebhook } from "../notifications/webhook-delivery.js";

/**
 * EscalationCapability: canal de escalonamento pra humano — quinto e
 * último item da auditoria comparando o agent/ com o ambiente deste
 * Claude Code. `Permissions.grant()` já existia como *hook* pra
 * "usuário aprovou pontualmente", mas não havia nenhum mecanismo VIVO
 * de "pausa e pergunta": nenhum jeito de um fluxo automatizado dizer
 * "preciso que um humano decida isso" e ter essa decisão chegar de
 * volta de forma estruturada.
 *
 * Deliberadamente ASSÍNCRONO, nunca bloqueante — um worker Cloud Run
 * não pode segurar uma requisição HTTP aberta esperando um humano por
 * minutos/horas (estouraria o timeout da requisição bem antes disso).
 * O fluxo real é:
 *   1. `escalation.request` cria um registro `pending` e (se
 *      `callbackUrl`/`callbackSecret` configurados) dispara um
 *      webhook assinado avisando que uma decisão humana é necessária
 *      — mesma entrega de `notifications/webhook-delivery.js` já
 *      usada por `process.start`.
 *   2. Quem recebeu o webhook (ou está fazendo polling via
 *      `escalation.get`/`escalation.list`) mostra a pergunta pra um
 *      humano.
 *   3. A decisão volta via `POST /escalations/:id/respond` (rota HTTP
 *      NOVA em `server.js`) ou via `escalation.respond` chamado
 *      internamente — as duas formas caem na MESMA lógica aqui, sem
 *      duplicação.
 *   4. Quem estava esperando a decisão (ex: o Orquestrador, numa
 *      chamada SEPARADA e posterior) consulta `escalation.get` e só
 *      então prossegue. A "pausa" é responsabilidade de quem orquestra
 *      o fluxo mais amplo, não desta capability — ela só guarda o
 *      estado da pergunta/resposta.
 *
 * Diferente de `plan.*`/`agent.dispatch`/`agent.dispatch_parallel`
 * (Orquestrador-only, nunca expostos via `extraCapabilities`, fora do
 * protocolo HTTP externo): esta é uma capability PADRÃO, registrada
 * direto em `agent.js` — achado real ao desenhar a rota HTTP nova:
 * `index.js` sobe o Worker de produção com `new Agent()` simples, SEM
 * nenhum preset de role aplicado (`orchestrator-example.js` é só
 * demonstração, nunca importada por `index.js`). Se `escalation.*`
 * fosse Orquestrador-only como os outros, a rota HTTP de resposta
 * nunca teria uma capability disponível pra chamar no Worker real —
 * humano-no-loop é fundamentalmente uma interação EXTERNA, não uma
 * preocupação interna de orquestração de sub-agentes.
 *
 * Armazenamento em memória — mesma decisão (e mesma ressalva) já
 * confirmada com o usuário pra `plan-tracker.js`: escopado à vida do
 * processo, não sobrevive a reinício do container.
 *
 * `deliverWebhookFn` é injetável no construtor (mesmo padrão de
 * `deliverWebhookFn` em `process.js`) — testes de unidade nunca
 * precisam de rede real.
 */
export class EscalationCapability {
  declare permissions: PermissionGuard | undefined;
  declare deliverWebhookFn: WebhookFn;
  declare escalations: Map<string, EscalationRecord>;

  constructor({ permissions, deliverWebhookFn = deliverWebhook as WebhookFn }: {
    permissions?: PermissionGuard;
    deliverWebhookFn?: WebhookFn;
  } = {}) {
    this.permissions = permissions;
    this.deliverWebhookFn = deliverWebhookFn;
    this.escalations = new Map();
  }

  async execute(task: EscalationTask) {
    this.permissions!.require(task.type);

    switch (task.type) {
      case "escalation.request":
        return this.request(task);

      case "escalation.respond":
        return this.respond(task);

      case "escalation.get":
        return this.get(task);

      case "escalation.list":
        return this.list();

      default:
        throw new Error(`Operação escalation desconhecida: ${task.type}`);
    }
  }

  _validateCallback(task: EscalationTask) {
    const hasUrl = task.callbackUrl !== undefined;
    const hasSecret = task.callbackSecret !== undefined;

    if (hasUrl !== hasSecret) {
      throw new Error(
        "escalation.request: callbackUrl e callbackSecret precisam ser informados JUNTOS (ou nenhum dos dois)",
      );
    }
  }

  async request(task: EscalationTask) {
    if (typeof task.question !== "string" || task.question.trim() === "") {
      throw new Error("escalation.request exige question (string não vazia)");
    }

    this._validateCallback(task);

    const now = Date.now();

    const escalation: EscalationRecord = {
      id: randomUUID(),
      question: task.question,
      context: task.context ?? null,
      status: "pending",
      decision: null,
      note: null,
      callbackUrl: task.callbackUrl || null,
      callbackSecret: task.callbackSecret || null,
      webhookDelivery: null,
      createdAt: now,
      updatedAt: now,
      respondedAt: null,
    };

    this.escalations.set(escalation.id, escalation);

    if (escalation.callbackUrl) {
      escalation.webhookDelivery = await this.deliverWebhookFn({
        url: escalation.callbackUrl,
        secret: escalation.callbackSecret,
        payload: {
          escalationId: escalation.id,
          evento: "escalation.criada",
          question: escalation.question,
          context: escalation.context,
        },
      }).catch((error) => ({
        delivered: false,
        deliveryId: null,
        statusCode: null,
        error: (error as Error).message,
        attemptedAt: Date.now(),
      }));
    }

    return this._publicView(escalation);
  }

  _requireEscalation(escalationId: string | undefined, taskType: string): EscalationRecord {
    if (typeof escalationId !== "string" || escalationId.trim() === "") {
      const error: Error & { code?: string } = new Error(`${taskType} exige escalationId (string)`);
      error.code = "VALIDATION_ERROR";
      throw error;
    }

    const escalation = this.escalations.get(escalationId);

    if (!escalation) {
      const error: Error & { code?: string } = new Error(`Escalonamento não encontrado: ${escalationId}`);
      error.code = "ESCALATION_NOT_FOUND";
      throw error;
    }

    return escalation;
  }

  /**
   * Resolve um escalonamento pendente. Transição de mão única
   * (`pending` -> `resolved`) — responder um escalonamento já
   * resolvido lança erro claro em vez de sobrescrever silenciosamente
   * uma decisão anterior. `.code` em cada erro lançado aqui (mesmo
   * padrão de `PERMISSION_DENIED`/`PROCESS_NOT_FOUND` já usado em
   * `permissions.js`/`process.js`) -- usado por `server.js` pra mapear
   * pro status HTTP certo na rota `POST /escalations/:id/respond`.
   */
  respond(task: EscalationTask) {
    const escalation = this._requireEscalation(task.escalationId, "escalation.respond");

    if (escalation.status !== "pending") {
      const error: Error & { code?: string } = new Error(
        `escalation.respond: escalonamento ${escalation.id} já foi respondido (status: ${escalation.status})`,
      );
      error.code = "ESCALATION_ALREADY_RESPONDED";
      throw error;
    }

    if (typeof task.decision !== "string" || task.decision.trim() === "") {
      const error: Error & { code?: string } = new Error("escalation.respond exige decision (string não vazia)");
      error.code = "VALIDATION_ERROR";
      throw error;
    }

    escalation.status = "resolved";
    escalation.decision = task.decision;
    escalation.note = task.note ?? null;
    escalation.updatedAt = Date.now();
    escalation.respondedAt = Date.now();

    return this._publicView(escalation);
  }

  get(task: EscalationTask) {
    const escalation = this._requireEscalation(task.escalationId, "escalation.get");

    return this._publicView(escalation);
  }

  list() {
    return {
      escalations: [...this.escalations.values()].map((escalation) => this._summarize(escalation)),
    };
  }

  // Nunca expõe callbackSecret de volta -- mesmo critério de
  // mcp-client.js's listServers() nunca expor headers com segredo.
  _publicView(escalation: EscalationRecord) {
    const { callbackSecret, ...rest } = escalation;
    return rest;
  }

  _summarize(escalation: EscalationRecord) {
    return {
      id: escalation.id,
      question: escalation.question,
      status: escalation.status,
      createdAt: escalation.createdAt,
      updatedAt: escalation.updatedAt,
    };
  }
}
