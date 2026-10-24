import { execa } from "execa";
import { randomUUID } from "node:crypto";
import { parseCommand } from "../utils/parse-command.js";
import { truncateOutput } from "../utils/run-command.js";
import { deliverWebhook } from "../notifications/webhook-delivery.js";

const DEFAULT_PROCESS_TIMEOUT_MS = 600000; // 10 min — kill automático do execa
const MAX_OUTPUT_CHARS = 200000;

/**
 * ProcessCapability: inicia processos controlados (ex: um servidor
 * de dev para testes de integração), com timeout automático,
 * captura de stdout/stderr (com limite de tamanho), consulta de
 * status e encerramento explícito.
 *
 * Diferente de TestCapability/BuildCapability/PackageCapability (que
 * rodam até o fim e retornam o resultado completo de uma vez), esta
 * é para processos que ficam rodando em background — por isso
 * mantém um registro em memória por instância (cada Agent tem a sua
 * própria, então processos de um Agent nunca vazam para outro).
 *
 * `process.start` aceita `callbackUrl`/`callbackSecret` opcionais —
 * quando informados (os dois JUNTOS, nunca só um), um webhook
 * assinado (`notifications/webhook-delivery.js`) é entregue quando o
 * processo terminar (`exited`/`timeout`/`error`/`killed`), evitando
 * que quem chamou precise ficar consultando `process.status` em
 * loop. O webhook é só uma OTIMIZAÇÃO de latência, nunca a única
 * fonte de verdade — a entrega é de melhor esforço, sem retry (ver
 * `webhook-delivery.js`), então `process.status`/`process.output`
 * continuam sendo o caminho confiável, com `webhookDelivery` exposto
 * neles pra dizer se a entrega funcionou ou não.
 */
export class ProcessCapability {
  constructor({ workspace, permissions, commandPolicy, deliverWebhookFn = deliverWebhook }) {
    if (!commandPolicy) {
      throw new Error(
        "ProcessCapability exige commandPolicy (allowlist dedicada de comandos de processo)",
      );
    }

    this.workspace = workspace;
    this.permissions = permissions;
    this.commandPolicy = commandPolicy;
    this.deliverWebhookFn = deliverWebhookFn;
    // processId -> { child, command, startedAt, stdout, stderr, status,
    // exitCode, callbackUrl, callbackSecret, webhookDelivery }
    this.processes = new Map();
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "process.start":
        return this.start(task);
      case "process.status":
        return this.status(task);
      case "process.output":
        return this.output(task);
      case "process.kill":
        return this.kill(task);
      default:
        throw new Error(`Operação process desconhecida: ${task.type}`);
    }
  }

  async start(task) {
    if (!task.command || typeof task.command !== "string") {
      throw new Error("process.start exige 'command' (string)");
    }

    this.commandPolicy.validate(task.command);
    this._validateCallback(task);

    const [executable, ...args] = parseCommand(task.command);
    // `??`, não `||`: timeoutMs === 0 é "sem timeout" explícito
    // (execa trata 0 como tal), não "não informado" — ver shell.js.
    const timeoutMs = task.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    const processId = randomUUID();

    const child = execa(executable, args, {
      cwd: this.workspace.root,
      reject: false,
      timeout: timeoutMs,
    });

    const record = {
      child,
      command: task.command,
      startedAt: Date.now(),
      stdout: "",
      stderr: "",
      status: "running",
      exitCode: null,
      callbackUrl: task.callbackUrl || null,
      callbackSecret: task.callbackSecret || null,
      webhookDelivery: null,
    };

    child.stdout?.on("data", (chunk) => {
      record.stdout = truncateOutput(
        record.stdout + chunk.toString(),
        MAX_OUTPUT_CHARS,
      );
    });

    child.stderr?.on("data", (chunk) => {
      record.stderr = truncateOutput(
        record.stderr + chunk.toString(),
        MAX_OUTPUT_CHARS,
      );
    });

    child
      .then((result) => {
        // record.status pode já ter sido setado como "killed" por
        // kill() antes do processo de fato terminar — não sobrescreve
        // nesse caso.
        if (record.status === "running") {
          record.status = result.timedOut ? "timeout" : "exited";
        }
        record.exitCode = result.exitCode ?? null;
      })
      .catch((error) => {
        if (record.status === "running") {
          record.status = "error";
        }
        record.error = error.message;
      })
      .then(() => this._notifyCallback(processId, record));

    this.processes.set(processId, record);

    return { processId, command: task.command, status: record.status };
  }

  _validateCallback(task) {
    const hasUrl = task.callbackUrl !== undefined;
    const hasSecret = task.callbackSecret !== undefined;

    if (hasUrl !== hasSecret) {
      throw new Error(
        "process.start: callbackUrl e callbackSecret precisam ser informados JUNTOS (ou nenhum dos dois)",
      );
    }
  }

  /**
   * Dispara o webhook de "processo terminado", se configurado.
   * Chamado só depois que `record.status`/`record.exitCode` já estão
   * no valor FINAL (encadeado depois do `.then()`/`.catch()` acima) —
   * `deliverWebhook` nunca lança por falha de entrega (rede, timeout,
   * status não-2xx, bloqueio de SSRF), só por erro de input, que já
   * foi validado em `_validateCallback` antes do processo nem
   * começar — então este `.catch()` aqui é só defesa em profundidade
   * extra, nunca esperado disparar na prática.
   */
  async _notifyCallback(processId, record) {
    if (!record.callbackUrl) {
      return;
    }

    record.webhookDelivery = await this.deliverWebhookFn({
      url: record.callbackUrl,
      secret: record.callbackSecret,
      payload: {
        processId,
        command: record.command,
        status: record.status,
        exitCode: record.exitCode,
        stdout: record.stdout,
        stderr: record.stderr,
        durationMs: Date.now() - record.startedAt,
      },
    }).catch((error) => ({
      delivered: false,
      deliveryId: null,
      statusCode: null,
      error: error.message,
      attemptedAt: Date.now(),
    }));
  }

  getRecord(task) {
    if (!task.processId || typeof task.processId !== "string") {
      throw new Error("processId (string) é obrigatório");
    }

    const record = this.processes.get(task.processId);

    if (!record) {
      const error = new Error(`Processo não encontrado: ${task.processId}`);
      error.code = "PROCESS_NOT_FOUND";
      throw error;
    }

    return record;
  }

  async status(task) {
    const record = this.getRecord(task);

    return {
      processId: task.processId,
      command: record.command,
      status: record.status,
      exitCode: record.exitCode,
      runningForMs: Date.now() - record.startedAt,
      // null enquanto não configurado OU enquanto o processo ainda
      // não terminou (webhook só dispara no final) -- {delivered,
      // statusCode, error} depois disso, ver _notifyCallback.
      webhookDelivery: record.webhookDelivery,
    };
  }

  async output(task) {
    const record = this.getRecord(task);

    return {
      processId: task.processId,
      status: record.status,
      stdout: record.stdout,
      stderr: record.stderr,
      webhookDelivery: record.webhookDelivery,
    };
  }

  async kill(task) {
    const record = this.getRecord(task);

    if (record.status === "running") {
      record.child.kill(task.signal || "SIGTERM");
      record.status = "killed";
    }

    return { processId: task.processId, status: record.status };
  }
}
