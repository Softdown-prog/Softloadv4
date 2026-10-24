import dns from "node:dns/promises";

// Hosts sempre bloqueados, independente de qualquer outra checagem --
// mesma lista (duplicada de propósito, não importada) de
// sandbox-efemoro/src/webSandbox/security.js: são dois serviços
// deployáveis SEPARADOS (Dockerfiles/package.json próprios), então
// compartilhar uma constante exigiria um pacote publicado só pra isso
// -- não vale a complexidade pra uma lista de 4 strings que muda raramente.
const ALWAYS_BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "169.254.169.254", // GCE/AWS/Azure metadata endpoint
  "169.254.170.2", // AWS ECS task metadata
  "100.100.100.200", // Alibaba Cloud metadata
]);

/**
 * IPv4 privado/reservado (RFC 1918, loopback, link-local/metadata,
 * CGNAT, benchmarking, multicast/reservado) -- mesmas faixas que
 * qualquer guia de proteção contra SSRF lista. Endereço malformado
 * também é tratado como bloqueado (falha segura).
 */
function isPrivateOrReservedIPv4(address) {
  const parts = address.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast/reservado/broadcast

  return false;
}

function isPrivateOrReservedIPv6(address) {
  const lower = address.toLowerCase();

  if (lower === "::1" || lower === "::") return true; // loopback/unspecified
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local

  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);

  return false;
}

function isPrivateOrReservedAddress({ address, family }) {
  return family === 6
    ? isPrivateOrReservedIPv6(address)
    : isPrivateOrReservedIPv4(address);
}

async function defaultResolveHostname(hostname) {
  try {
    return await dns.lookup(hostname, { all: true });
  } catch {
    return [];
  }
}

/**
 * Fonte única da proteção contra SSRF usada por QUALQUER capability
 * deste agent/ que faça uma requisição de rede pra uma URL fornecida
 * pelo chamador (não uma URL fixa própria) -- hoje: `web-fetch.js`
 * (busca de URL) e `notifications/webhook-delivery.js` (entrega de
 * webhook). Extraído pra cá quando o segundo consumidor real apareceu
 * -- antes disso, viveu só dentro de web-fetch.js (ver histórico de
 * `agent.dispatch_parallel`/`web.fetch` no README pra contexto).
 *
 * Três camadas, best-effort (mesma limitação já documentada em
 * sandbox-efemoro/src/webSandbox/network.js -- não elimina TOCTOU
 * entre a checagem e a conexão real, proteção completa exige política
 * de rede no nível do container):
 *   1. Só protocolo http/https.
 *   2. Lista fixa de hosts sempre bloqueados (endpoints de metadata de
 *      nuvem), verificada antes de qualquer outra coisa.
 *   3. Resolução DNS do host, com o(s) endereço(s) resultante(s)
 *      verificados contra faixas privadas/reservadas (RFC 1918,
 *      loopback, link-local, CGNAT, multicast).
 *
 * Quem segue redirecionamento (ex: web-fetch.js) precisa chamar isto
 * de novo pra CADA hop -- esta função só valida a URL passada a ela,
 * não tem noção de redirecionamento.
 *
 * `label` prefixa as mensagens de erro (ex: "web.fetch", "webhook"),
 * pra quem chama poder identificar de onde veio o erro sem precisar
 * de contexto adicional.
 */
export async function assertUrlIsFetchable(
  urlString,
  { resolveHostname = defaultResolveHostname, label = "ssrf-guard" } = {},
) {
  let parsed;

  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`${label}: URL inválida: ${urlString}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `${label}: só protocolos http/https são permitidos (recebido: ${parsed.protocol})`,
    );
  }

  if (ALWAYS_BLOCKED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `${label}: host sempre bloqueado (endpoint de metadata de nuvem): ${parsed.hostname}`,
    );
  }

  const addresses = await resolveHostname(parsed.hostname);

  if (addresses.length === 0) {
    throw new Error(`${label}: não foi possível resolver o host: ${parsed.hostname}`);
  }

  const blocked = addresses.find(isPrivateOrReservedAddress);

  if (blocked) {
    throw new Error(
      `${label}: host resolve para endereço privado/reservado (${blocked.address}) -- bloqueado por proteção contra SSRF: ${parsed.hostname}`,
    );
  }

  return parsed;
}

export {
  ALWAYS_BLOCKED_HOSTS,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  isPrivateOrReservedAddress,
  defaultResolveHostname,
};
