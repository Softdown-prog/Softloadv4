/**
 * Na imagem leve o Chromium não existe: /run nunca deve tentar lançá-lo.
 * O modo padrão da imagem completa preserva o contrato legado.
 */
export type SandboxMode = "full" | "archive" | "browser";
export type SandboxCapability = "archive" | "browser";

export function resolveSandboxMode(env: Record<string, string | undefined> = process.env): SandboxMode {
  const hasChromium = env.SANDBOX_CHROMIUM_INSTALLED !== "0";
  const mode = env.SANDBOX_MODE?.trim() || (hasChromium ? "full" : "archive");
  if (!["full", "archive", "browser"].includes(mode)) {
    throw new Error("SANDBOX_MODE deve ser full, archive ou browser.");
  }
  if (!hasChromium && mode !== "archive") {
    throw new Error("SANDBOX_MODE exige Chromium, mas SANDBOX_CHROMIUM_INSTALLED=0.");
  }
  return mode as SandboxMode;
}

export function sandboxSupports(mode: SandboxMode, capability: SandboxCapability): boolean {
  if (!["archive", "browser"].includes(capability)) {
    throw new Error(`Capacidade desconhecida: ${capability}`);
  }
  return mode === "full" || mode === capability;
}
