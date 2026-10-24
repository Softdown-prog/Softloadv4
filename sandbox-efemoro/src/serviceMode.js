/**
 * Na imagem leve o Chromium não existe: /run nunca deve tentar lançá-lo.
 * O modo padrão da imagem completa preserva o contrato legado.
 */
export function resolveSandboxMode(env = process.env) {
  const hasChromium = env.SANDBOX_CHROMIUM_INSTALLED !== "0";
  const mode = env.SANDBOX_MODE?.trim() || (hasChromium ? "full" : "archive");
  if (!["full", "archive", "browser"].includes(mode)) {
    throw new Error("SANDBOX_MODE deve ser full, archive ou browser.");
  }
  if (!hasChromium && mode !== "archive") {
    throw new Error("SANDBOX_MODE exige Chromium, mas SANDBOX_CHROMIUM_INSTALLED=0.");
  }
  return mode;
}

export function sandboxSupports(mode, capability) {
  if (!["archive", "browser"].includes(capability)) {
    throw new Error(`Capacidade desconhecida: ${capability}`);
  }
  return mode === "full" || mode === capability;
}
