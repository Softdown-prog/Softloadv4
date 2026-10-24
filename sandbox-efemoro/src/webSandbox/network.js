import dns from "node:dns/promises";
import { ALWAYS_BLOCKED_HOSTS } from "./security.js";

// Hosts de loopback aceitos por padrão -- mas SEMPRE escopados à
// porta da própria URL sendo testada (ver setupNetworkPolicy), nunca
// "qualquer porta em localhost". Isso fecha o achado da revisão do
// documento original: a allowlist antiga liberava localhost/127.0.0.1
// em QUALQUER porta, então qualquer outro serviço rodando em loopback
// na mesma máquina (não só a app sob teste) ficava alcançável pela
// página sob teste.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

// Cache de resolução DNS por hostname durante uma execução -- evita
// bater em DNS a cada requisição da página, e mantém a decisão
// consistente ao longo de uma mesma auditoria.
function createResolutionCache() {
  const cache = new Map();
  return async function resolveHostname(hostname) {
    if (cache.has(hostname)) return cache.get(hostname);
    let addresses;
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      addresses = [];
    }
    cache.set(hostname, addresses);
    return addresses;
  };
}

function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address.startsWith("127.");
}

/**
 * Constrói o conjunto de "host:porta" permitidos para esta execução,
 * a partir da URL alvo (sempre permitida, na sua própria porta) e das
 * entradas extras fornecidas pelo chamador (host ou host:porta).
 */
function buildAllowlist(targetUrl, allowedHosts) {
  const entries = new Set();
  const targetPort = targetUrl.port || (targetUrl.protocol === "https:" ? "443" : "80");
  entries.add(`${targetUrl.hostname}:${targetPort}`);

  for (const raw of allowedHosts) {
    const [host, port] = raw.split(":");
    if (port) {
      entries.add(`${host}:${port}`);
    } else {
      // Sem porta explícita: permite qualquer porta SÓ para hosts
      // explicitamente informados pelo chamador (não para os
      // loopback padrão, que ficam restritos à porta da URL alvo).
      entries.add(host); // marcador "qualquer porta" para este host
    }
  }

  return entries;
}

function isAllowed(allowlist, hostname, port) {
  if (allowlist.has(`${hostname}:${port}`)) return true;
  if (allowlist.has(hostname)) return true; // entrada "qualquer porta"
  return false;
}

/**
 * Configura política de rede: permite apenas a URL alvo (na sua
 * própria porta) e os hosts extras da allowlist do chamador. Bloqueia
 * tudo mais, incluindo endpoints de metadata de nuvem mesmo que
 * alguém tenha (erroneamente) tentado allowlist-á-los.
 *
 * Limitação conhecida (documentada, não escondida): o Playwright NÃO
 * intercepta conexões WebSocket via context.route() -- uma página sob
 * teste pode abrir `new WebSocket(...)` para qualquer host e isso não
 * passa por esta política. Mitigação real disso precisa ser em nível
 * de container/rede (ex: --network policy restritiva no ambiente de
 * execução), não só nesta camada de aplicação.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string[]} allowedHosts
 * @param {URL} targetUrl
 */
async function setupNetworkPolicy(context, allowedHosts, targetUrl) {
  const blockedRequests = [];
  const failedRequests = [];
  const allowlist = buildAllowlist(targetUrl, allowedHosts);
  const resolveHostname = createResolutionCache();

  await context.route("**/*", async (route) => {
    const request = route.request();
    let url;
    try {
      url = new URL(request.url());
    } catch {
      route.abort();
      return;
    }
    const hostname = url.hostname;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");

    // Bloqueio incondicional de endpoints de metadata, antes de
    // qualquer checagem de allowlist.
    if (ALWAYS_BLOCKED_HOSTS.has(hostname)) {
      blockedRequests.push({
        url: request.url(),
        hostname,
        reason: "Blocked: cloud metadata endpoint",
      });
      route.abort();
      return;
    }

    if (!isAllowed(allowlist, hostname, port)) {
      blockedRequests.push({
        url: request.url(),
        hostname,
        reason: "Blocked by network policy (not in allowlist)",
      });
      route.abort();
      return;
    }

    // Mitigação best-effort de DNS rebinding: se o hostname é um dos
    // nomes de loopback padrão, confirma que ele de fato resolve para
    // um endereço de loopback de verdade (protege contra /etc/hosts
    // ou DNS custom remapeando "localhost" para outro lugar). Não
    // elimina TOCTOU (a resolução pode mudar entre esta checagem e a
    // conexão real do navegador) -- proteção completa exige política
    // de rede no nível do container, não só aqui.
    if (LOOPBACK_HOSTS.has(hostname) && hostname !== "0.0.0.0") {
      const addresses = await resolveHostname(hostname);
      const resolvesToLoopback =
        addresses.length === 0 || addresses.every((a) => isLoopbackAddress(a.address));
      if (!resolvesToLoopback) {
        blockedRequests.push({
          url: request.url(),
          hostname,
          reason: "Blocked: hostname de loopback não resolveu para endereço loopback (possível DNS rebinding)",
        });
        route.abort();
        return;
      }
    }

    route.continue();
  });

  // Única fonte de verdade para falhas de requisição: eventos de
  // página se propagam para o contexto no Playwright, então registrar
  // aqui (context.on) já cobre todas as páginas -- registrar de novo
  // a nível de página (como o documento original fazia em paralelo)
  // duplicava cada falha no resultado final.
  context.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || "Unknown failure",
    });
  });

  return { blockedRequests, failedRequests };
}

export { setupNetworkPolicy, buildAllowlist, isAllowed, LOOPBACK_HOSTS };
