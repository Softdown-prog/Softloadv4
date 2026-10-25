// Serviço deliberadamente isolado do Agent: saída JSON para Cloud Logging.
export type SandboxLogData = unknown;

export interface SandboxLogger {
  info(message: string, data?: SandboxLogData): void;
  warn(message: string, data?: SandboxLogData): void;
  error(message: string, data?: SandboxLogData): void;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createLogger(scope: string): SandboxLogger {
  return {
    info(message: string, data: SandboxLogData = undefined): void {
      console.log(JSON.stringify({ timestamp: timestamp(), severity: "INFO", scope, message, data }));
    },
    warn(message: string, data: SandboxLogData = undefined): void {
      console.warn(JSON.stringify({ timestamp: timestamp(), severity: "WARNING", scope, message, data }));
    },
    error(message: string, data: SandboxLogData = undefined): void {
      console.error(JSON.stringify({ timestamp: timestamp(), severity: "ERROR", scope, message, data }));
    },
  };
}
