/**
 * Retorna o timestamp atual em formato ISO 8601, usado em cada
 * entrada de log.
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * createLogger: cria um logger estruturado (saída em JSON) com um
 * `scope` fixo (ex: "agent", "worker-agent", "task-runner"), para
 * facilitar filtrar logs por origem.
 *
 * Formato compatível com o Cloud Logging do Google Cloud (usado
 * pelo Cloud Run): o campo `severity` é reconhecido automaticamente
 * pelo parser de logs estruturados do GCP, permitindo filtrar e
 * colorir corretamente por nível (INFO / WARNING / ERROR) no
 * console do Cloud Logging — diferente de um campo customizado como
 * `level`, que o GCP não interpreta e trataria como metadado comum.
 *
 * Valores de severidade seguem a nomenclatura que o Cloud Logging
 * espera (note "WARNING", não "WARN").
 */
export function createLogger(scope: string) {
  return {
    info(message: string, data: unknown = undefined) {
      // console.log -> stdout
      console.log(
        JSON.stringify({
          timestamp: timestamp(),
          severity: "INFO",
          scope,
          message,
          data,
        }),
      );
    },

    warn(message: string, data: unknown = undefined) {
      // console.warn -> stderr no Node. Sem o campo `severity`
      // correto, o Cloud Run tende a marcar tudo que vem de stderr
      // como ERROR — por isso é importante que `severity: "WARNING"`
      // esteja explícito no payload.
      console.warn(
        JSON.stringify({
          timestamp: timestamp(),
          severity: "WARNING",
          scope,
          message,
          data,
        }),
      );
    },

    error(message: string, data: unknown = undefined) {
      // console.error -> stderr
      console.error(
        JSON.stringify({
          timestamp: timestamp(),
          severity: "ERROR",
          scope,
          message,
          data,
        }),
      );
    },
  };
}
