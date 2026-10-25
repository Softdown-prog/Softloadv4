/** Contrato de configuração HTTP do sandbox, sem alterar URLs ou segredos. */
declare const process: { env: Record<string, string | undefined> };
/**
 * Opcionalmente roteia auditorias web e extrações para serviços diferentes.
 * Na ausência das URLs dedicadas usa a configuração legada da VPS.
 */
const ENDPOINTS: Readonly<Record<string, { url: string; secret: string }>> = Object.freeze({
  browser: { url: "SANDBOX_BROWSER_SERVICE_URL", secret: "SANDBOX_BROWSER_SHARED_SECRET" },
  archive: { url: "SANDBOX_ARCHIVE_SERVICE_URL", secret: "SANDBOX_ARCHIVE_SHARED_SECRET" },
});

export function resolveSandboxEndpoint(capability: string, env: Record<string, string | undefined> = process.env) {
  const spec = ENDPOINTS[capability];
  if (!spec) throw new Error(`Capacidade desconhecida: ${capability}`);
  const rawUrl = env[spec.url] || env.SANDBOX_SERVICE_URL;
  return {
    serviceUrl: typeof rawUrl === "string" ? rawUrl.replace(/\/+$/, "") : undefined,
    secret: env[spec.secret] || env.SANDBOX_SHARED_SECRET,
  };
}
