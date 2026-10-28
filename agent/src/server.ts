import type { AgentTask } from "./core/task-router.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Contrato do limite HTTP: payload validado pelo protocolo antes do
 * dispatch. A resposta do Agent e normalizada pelo TaskRunner.
 */
interface WorkerAgent {
  execute(task: AgentTask): Promise<unknown>;
}
type WorkerOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code?: string; message: string } };
type HttpError = Error & { code?: string; type?: string };
declare const process: { env: Record<string, string | undefined> };

import express from "express";
import { timingSafeEqual } from "node:crypto";
import { parseTaskRequest, getSupportedOperations, ProtocolError } from "./protocol/protocol.js";
import { requestToTasks } from "./protocol/protocol-adapter.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("worker-agent-server");

// Mapa de `.code` de erro (ver escalation.js/permissions.js) -> status
// HTTP, usado só pela rota POST /escalations/:id/respond (única rota
// deste servidor com status HTTP convencional por erro -- /run sempre
// devolve 200 com {ok:false} por action, ver comentário na rota).
const ESCALATION_ERROR_STATUS: Record<string, number> = {
  PERMISSION_DENIED: 403,
  ESCALATION_NOT_FOUND: 404,
  ESCALATION_ALREADY_RESPONDED: 409,
  VALIDATION_ERROR: 400,
};

/**
 * Monta o app Express do Worker Agent, já ligado a um `Agent`
 * específico (já iniciado -- `agent.start()` já deve ter sido
 * chamado). Não chama `listen()` -- quem chama decide a porta
 * (`index.js` em produção; testes montam o app numa porta efêmera,
 * mesmo padrão de sandbox-efemoro/src/server.js).
 *
 * Pipeline de `POST /run`: `parseTaskRequest()` (Zod, protocol.js) →
 * `requestToTasks()` (protocol-adapter.js, snake_case→camelCase) →
 * `agent.execute()` por task, SEQUENCIAL (não paralelo -- actions do
 * mesmo request podem depender de ordem, ex: `file.write` seguido de
 * `file.read` do mesmo arquivo; rodar em paralelo tornaria isso
 * não-determinístico).
 *
 * Recebe qualquer implementação compatível com WorkerAgent.
 */
export function createApp(agent: WorkerAgent) {
  const app = express();

  // Limite de corpo -- uma request com até 50 actions (teto do
  // protocolo) ainda cabe folgado nisso; um corpo maior não tem
  // motivo legítimo e só serviria pra esgotar memória.
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Introspecção: lista capability/operação suportada -- útil pra
  // quem monta o payload de /run saber o que está disponível sem
  // precisar ler o código-fonte do protocolo.
  app.get("/capabilities", requireSharedSecret, (req, res) => {
    const operations = getSupportedOperations();
    for (const name of ['storage', 'artifacts', 'web-sandbox', 'archive', 'web-search']) delete operations[name];
    res.status(200).json(operations);
  });

  // Segredo compartilhado simples entre quem despacha tasks e este
  // Worker -- mesmo padrão já usado em sandbox-efemoro/src/server.js
  // (SANDBOX_SHARED_SECRET/x-sandbox-secret) e nos endpoints internos
  // do app principal (SOLARIS_RAG_SEARCH_SECRET etc.): defesa em
  // profundidade mínima, não a única camada (o ideal em produção é
  // também restringir por IAM/rede do Cloud Run).
  const sharedSecret = process.env.WORKER_SHARED_SECRET?.trim();
  const allowUnauthenticated = process.env.WORKER_ALLOW_UNAUTHENTICATED === 'true' &&
    ['development', 'test'].includes(process.env.NODE_ENV || '');
  if (!sharedSecret) {
    logger.warn(
      "Autenticação do Worker não configurada; ações protegidas indisponíveis, salvo opt-in explícito em desenvolvimento/teste.",
    );
  }

  function requireSharedSecret(req: Request, res: Response, next: NextFunction) {
    if (!sharedSecret) {
      if (allowUnauthenticated) return next();
      return res.status(503).json({ error: 'worker_auth_not_configured' });
    }
    const provided = req.get("x-worker-secret");
    if (typeof provided !== 'string' || Buffer.byteLength(provided, 'utf8') !== Buffer.byteLength(sharedSecret, 'utf8') ||
        !timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(sharedSecret, 'utf8'))) {
      return res.status(401).json({ error: "unauthorized" });
    }
    return next();
  }

  app.post("/run", requireSharedSecret, async (req, res) => {
    let request;
    try {
      request = parseTaskRequest(req.body);
    } catch (err) {
      if (err instanceof ProtocolError) {
        return res.status(400).json({
          error: err.code,
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }

    const tasks = requestToTasks(request);
    // The HTTP contract has no user-scoped budget reservation yet. Never bill
    // the shared Gemini key from a caller-controlled task identifier.
    if (request.actions.some(action => action.capability === 'web-search')) {
      return res.status(503).json({ error: 'paid_capability_budget_unavailable' });
    }
    if (request.actions.some(action => ['storage', 'artifacts'].includes(action.capability))) {
      return res.status(400).json({ error: 'capability_unavailable' });
    }
    const results: Array<Record<string, unknown>> = [];

    for (const { actionId, task } of tasks) {
      try {
        const result = (await agent.execute(task)) as WorkerOutcome;
        results.push({ actionId, ...result });
      } catch (err) {
        // agent.execute() lança (não devolve {ok:false}) pra erro de
        // ROTEAMENTO (task.type desconhecido, capability não
        // carregada -- ver TaskRouter.resolve()/TaskRunner). Uma
        // action malformada no meio de um lote de até 50 nunca deve
        // derrubar as demais -- normaliza pro mesmo formato de falha
        // que TaskRunner já usa pras falhas de execução.
        results.push({
          actionId,
          ok: false,
          taskType: task.type,
          error: {
            message: (err as HttpError).message,
            code: (err as HttpError).code || "TASK_ROUTING_FAILED",
          },
        });
      }
    }

    res.status(200).json({ requestId: request.request_id, results });
  });

  // Rota HTTP dedicada (fora do protocolo genérico de /run) pra
  // receber a resposta de um escalonamento humano de volta --
  // `escalation.request` (via /run) dispara um webhook avisando que
  // uma decisão é necessária; quem recebe esse webhook chama ESTA
  // rota quando o humano decidir. Gated pelo mesmo segredo
  // compartilhado de /run (mesmo perímetro de confiança: quem pode
  // despachar tasks pra este Worker também pode responder um
  // escalonamento dele).
  //
  // Reusa `agent.execute({type:"escalation.respond",...})` --
  // MESMA lógica de validação/estado de `capabilities/escalation.js`,
  // sem duplicar nada aqui. `.code` de cada erro (ver escalation.js e
  // Permissions.require()) mapeado pro status HTTP correspondente,
  // diferente de /run (que sempre devolve 200 com {ok:false} por
  // action) -- esta é uma rota dedicada de propósito único, então
  // status HTTP convencional é mais natural pra quem a consome de
  // fora (verificar `resp.ok`/status direto, sem precisar parsear um
  // envelope de batch).
  app.post("/escalations/:escalationId/respond", requireSharedSecret, async (req, res) => {
    const { escalationId } = req.params;
    const { decision, note } = req.body || {};

    try {
      // agent.execute() (via TaskRunner) NÃO lança pra falha de
      // EXECUÇÃO (validação, não encontrado, já respondido,
      // permissão negada) -- sempre devolve {ok:false, error:{message,
      // code}} normalmente (mesmo formato usado por /run). Só lança
      // pra falha de ROTEAMENTO (task.type desconhecido -- não
      // deveria acontecer aqui, "escalation.respond" é fixo).
      const outcome = (await agent.execute({
        type: "escalation.respond",
        escalationId,
        decision,
        note,
      })) as WorkerOutcome;

      if (outcome.ok) {
        return res.status(200).json(outcome.result);
      }

      const status = ESCALATION_ERROR_STATUS[outcome.error.code!] || 500;

      if (status === 500) {
        logger.error("Erro não tratado em POST /escalations/:id/respond", {
          error: outcome.error.message,
        });
      }

      return res.status(status).json({
        error: outcome.error.code || "INTERNAL_ERROR",
        message: outcome.error.message,
      });
    } catch (err) {
      logger.error("Erro de roteamento em POST /escalations/:id/respond", {
        error: (err as HttpError).message,
        stack: (err as HttpError).stack,
      });

      return res.status(500).json({
        error: (err as HttpError).code || "INTERNAL_ERROR",
        message: (err as HttpError).message,
      });
    }
  });

  // Handler de erro do body parser (JSON malformado/corpo grande demais)
  // -- sem isto, o express deixaria a stack trace vazar pra resposta em
  // alguns setups. Mesmo padrão de sandbox-efemoro/src/server.js.
  app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
      return res.status(400).json({ error: "invalid_request", message: "Corpo JSON inválido ou acima do limite." });
    }
    logger.error("Erro não tratado em /run", { error: err.message, stack: err.stack });
    return res.status(500).json({ error: "internal_error", message: "Não foi possível executar a solicitação." });
  });

  return app;
}
