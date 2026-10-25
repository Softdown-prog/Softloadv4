/**
 * Contratos TypeScript do Worker Agent. Importacao 'type' e apagada
 * na transpilacao: nao adiciona dependencias no runtime da VPS.
 */
export interface PermissionGuard {
  require(taskType: string): void;
}

export interface CapabilityTask {
  type: string;
  [key: string]: unknown;
}

export interface CapabilityResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

export type CapabilityFetch = (
  url: string,
  options: { method: string; headers: Record<string, string>; body: string },
) => Promise<CapabilityResponse>;
