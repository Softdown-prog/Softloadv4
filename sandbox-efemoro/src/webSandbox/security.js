// Validação de entrada da capability. Ponto único por onde toda opção
// externa passa antes de tocar o Playwright.

const DEFAULT_BROWSER = "chromium";
const DEFAULT_DEVICE = "desktop";
const DEFAULT_TIMEOUT = 30000;
const MIN_TIMEOUT = 1000;
const MAX_TIMEOUT = 120000;
const ALLOWED_BROWSERS = ["chromium", "webkit"];
const ALLOWED_DEVICES = [
  "desktop",
  "android-mobile",
  "iphone",
  "tablet",
  "mobile-landscape",
];

// Hosts sempre bloqueados, independente de allowlist -- endpoints de
// metadata de nuvem não têm motivo legítimo para serem alcançados por
// uma página sob teste. Isso é reforço de defesa em profundidade: a
// allowlist por padrão já não os inclui, mas um allowedHosts mal
// configurado (ex: alguém adiciona "*" por engano, ou um wildcard
// futuro) não deve conseguir reabrir esse acesso.
const ALWAYS_BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "169.254.169.254", // GCE/AWS/Azure metadata endpoint
  "169.254.170.2", // AWS ECS task metadata
  "100.100.100.200", // Alibaba Cloud metadata
]);

/**
 * Valida e normaliza as opções de entrada.
 * @param {object} options
 * @returns {object} Opções validadas.
 */
function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Options object is required");
  }

  const url = validateUrl(options.url);

  const browserType =
    options.browser && ALLOWED_BROWSERS.includes(options.browser)
      ? options.browser
      : DEFAULT_BROWSER;

  const device =
    options.device && ALLOWED_DEVICES.includes(options.device)
      ? options.device
      : DEFAULT_DEVICE;

  const viewport = options.viewport ?? null;

  const screenshot =
    typeof options.screenshot === "boolean" ? options.screenshot : true;

  // `inline` é a entrega de PNG via HTTP, com teto de bytes. O
  // default continua `path` para clientes antigos do serviço.
  const screenshotDelivery = options.screenshotDelivery ?? "path";
  // Auditorias de IA podem pedir viewport para limitar custo/tamanho;
  // clientes antigos seguem capturando página inteira.
  const screenshotMode = options.screenshotMode ?? "auto";
  if (!["auto", "viewport"].includes(screenshotMode)) {
    throw new Error("screenshotMode deve ser auto ou viewport");
  }
  if (!["path", "inline"].includes(screenshotDelivery)) {
    throw new Error("screenshotDelivery deve ser path ou inline");
  }

  const accessibility =
    typeof options.accessibility === "boolean" ? options.accessibility : true;

  const timeout =
    Number.isInteger(options.timeout) &&
    options.timeout >= MIN_TIMEOUT &&
    options.timeout <= MAX_TIMEOUT
      ? options.timeout
      : DEFAULT_TIMEOUT;

  const allowedHosts = validateAllowedHosts(options.allowedHosts);

  return {
    url,
    browserType,
    device,
    viewport,
    screenshot,
    screenshotDelivery,
    screenshotMode,
    accessibility,
    timeout,
    allowedHosts,
  };
}

/**
 * Valida a lista de hosts extras permitidos pelo chamador. Cada
 * entrada pode ser "host" (qualquer porta) ou "host:porta" (porta
 * específica) -- ver network.js para como isso é aplicado. Rejeita
 * silenciosamente tentativas de incluir hosts da lista de bloqueio
 * fixa (ALWAYS_BLOCKED_HOSTS) em vez de deixar passar.
 */
function validateAllowedHosts(allowedHosts) {
  if (allowedHosts === undefined || allowedHosts === null) {
    return [];
  }
  if (!Array.isArray(allowedHosts)) {
    throw new Error("allowedHosts deve ser um array de strings");
  }

  return allowedHosts.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error("Cada entrada de allowedHosts deve ser uma string não vazia");
    }
    const trimmed = entry.trim();
    const hostOnly = trimmed.split(":")[0];
    if (ALWAYS_BLOCKED_HOSTS.has(hostOnly)) {
      throw new Error(
        `allowedHosts não pode incluir "${hostOnly}" -- endpoint de metadata de nuvem sempre bloqueado`,
      );
    }
    return trimmed;
  });
}

/**
 * Valida a URL fornecida. Deve ser http/https. A checagem de qual
 * HOST é de fato alcançável (localhost/loopback ou allowlist) é
 * responsabilidade da política de rede (network.js), aplicada em
 * tempo de requisição -- aqui só garantimos que é uma URL bem
 * formada com protocolo aceitável.
 * @param {string} url
 * @returns {string} URL normalizada.
 */
function validateUrl(url) {
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("URL is required and must be a string");
  }
  const trimmed = url.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid URL: " + trimmed);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https protocols are allowed");
  }

  if (ALWAYS_BLOCKED_HOSTS.has(parsed.hostname)) {
    throw new Error(`URL aponta para um host sempre bloqueado: ${parsed.hostname}`);
  }

  return trimmed;
}

export {
  validateOptions,
  validateUrl,
  validateAllowedHosts,
  ALWAYS_BLOCKED_HOSTS,
  DEFAULT_TIMEOUT,
  MIN_TIMEOUT,
  MAX_TIMEOUT,
};
