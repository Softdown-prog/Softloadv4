/**
 * AgentError: erro genérico usado nas camadas centrais do agent
 * (TaskRouter, TaskRunner) para sinalizar falhas de roteamento ou
 * execução de tasks — como "tarefa sem type" ou "nenhuma capability
 * encontrada para: X".
 *
 * Separado num arquivo próprio (em vez de usar `Error` puro) para
 * permitir, no futuro, diferenciar esses erros de outros tipos de
 * erro no código (ex: via `error instanceof AgentError`) e/ou
 * anexar um `code` estável, como já é feito em ProtocolError
 * (src/protocol/protocol.js) e no erro de PERMISSION_DENIED
 * (security/permissions.js).
 */
export class AgentError extends Error {
  declare code: string;
  declare details: unknown;

  constructor(message: string, code: string = "AGENT_ERROR", details: unknown = undefined) {
    super(message);

    this.name = "AgentError";
    this.code = code;
    this.details = details;
  }
}
