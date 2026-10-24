// Logger estruturado (JSON), compatível com o parser do Cloud Logging
// do GCP -- mesmo formato usado em agent/src/utils/logger.js, mantido
// aqui como cópia própria porque este serviço é deliberadamente
// isolado (container/deploy separado, sem dependências compartilhadas
// com agent/).

function timestamp() {
  return new Date().toISOString();
}

export function createLogger(scope) {
  return {
    info(message, data = undefined) {
      console.log(JSON.stringify({ timestamp: timestamp(), severity: "INFO", scope, message, data }));
    },
    warn(message, data = undefined) {
      console.warn(JSON.stringify({ timestamp: timestamp(), severity: "WARNING", scope, message, data }));
    },
    error(message, data = undefined) {
      console.error(JSON.stringify({ timestamp: timestamp(), severity: "ERROR", scope, message, data }));
    },
  };
}
