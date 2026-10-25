import type { PermissionGuard } from "./capability-types.js";

export interface WebFetchTask {
  type: string;
  url?: string;
  timeoutMs?: number;
  maxBytes?: number;
}
type WebFetchResolver = typeof defaultResolveHostname;

import { convert } from "html-to-text";
import { assertUrlIsFetchable, defaultResolveHostname } from "../security/ssrf-guard.js";

// Timeout/tamanho: mesma ordem de grandeza dos outros limites de rede
// deste agent/ (web-sandbox.js usa teto de 120s; aqui um teto bem mais
// conservador, já que é um GET simples, não uma auditoria de
// navegador completa).
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 60000;
const DEFAULT_MAX_BYTES = 1024 * 1024; // 1MB
const HARD_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_REDIRECTS = 5;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

// Tipos de conteúdo tratados como texto -- qualquer outra coisa
// (imagem, binário, vídeo, etc.) é rejeitada com erro claro, já que
// não há como "ler o que tem" num binário. Sem Content-Type (alguns
// servidores omitem), melhor esforço: trata como texto.
const TEXTUAL_CONTENT_TYPE_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "application/rss+xml",
  "application/atom+xml",
];

function baseContentType(contentType: string | null | undefined) {
  return (contentType || "").split(";")[0].trim().toLowerCase();
}

function isTextualContentType(contentType: string | null | undefined) {
  if (!contentType) return true;
  const base = baseContentType(contentType);
  return TEXTUAL_CONTENT_TYPE_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function isHtmlContentType(contentType: string | null | undefined) {
  const base = baseContentType(contentType);
  return base === "text/html" || base === "application/xhtml+xml";
}

/**
 * WebFetchCapability: busca o conteúdo de uma URL específica
 * diretamente (`GET`), diferente de `web.search` (que nunca acessa
 * uma URL arbitrária -- só consulta a Gemini API com Google Search
 * Grounding). É o equivalente ao WebFetch deste próprio Claude Code:
 * "lê essa URL e me diz o que tem".
 *
 * Proteção contra SSRF (3 camadas, best-effort) delegada a
 * `security/ssrf-guard.js` -- fonte única, compartilhada com
 * `notifications/webhook-delivery.js` (o outro consumidor real desde
 * que o webhook de saída de `process.start` foi implementado).
 * Reaplicada a CADA hop de redirecionamento seguido manualmente
 * (`redirect: "manual"`, nunca `redirect: "follow"`), não só na URL
 * original -- um servidor malicioso poderia redirecionar de uma URL
 * pública pra um endereço interno.
 *
 * `fetchImpl`/`resolveHostname` são injetáveis no construtor (mesmo
 * padrão de `fetchImpl` em web-sandbox.js/knowledge-search.js) --
 * testes de unidade nunca precisam de rede real, e o teste de ponta a
 * ponta usa um servidor HTTP local de verdade com `resolveHostname`
 * injetado (a política de bloqueio de endereço privado continua rodando
 * de verdade no teste -- só a RESOLUÇÃO é simulada, pra permitir testar
 * contra 127.0.0.1 sem precisar reabrir loopback em produção).
 */
export class WebFetchCapability {
  declare permissions: PermissionGuard | undefined;
  declare fetchImpl: typeof fetch;
  declare resolveHostname: WebFetchResolver;

  constructor({
    permissions,
    fetchImpl = fetch,
    resolveHostname = defaultResolveHostname,
  }: {
    permissions?: PermissionGuard;
    fetchImpl?: typeof fetch;
    resolveHostname?: WebFetchResolver;
  } = {}) {
    this.permissions = permissions;
    this.fetchImpl = fetchImpl;
    this.resolveHostname = resolveHostname;
  }

  async execute(task: WebFetchTask) {
    this.permissions!.require(task.type);

    switch (task.type) {
      case "web.fetch":
        return this.fetchUrl(task);

      default:
        throw new Error(`Operação web-fetch desconhecida: ${task.type}`);
    }
  }

  async fetchUrl(task: WebFetchTask) {
    if (typeof task.url !== "string" || task.url.trim() === "") {
      throw new Error("web.fetch exige url (string)");
    }

    const timeoutMs = Math.min(
      Number.isInteger(task.timeoutMs) && task.timeoutMs! > 0
        ? task.timeoutMs!
        : DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );

    const maxBytes = Math.min(
      Number.isInteger(task.maxBytes) && task.maxBytes! > 0
        ? task.maxBytes!
        : DEFAULT_MAX_BYTES,
      HARD_MAX_BYTES,
    );

    let currentUrl = task.url.trim();
    let response: Response;
    let redirectCount = 0;

    // Segue redirecionamento manualmente (nunca `redirect: "follow"`
    // do fetch nativo) para poder revalidar CADA hop contra a mesma
    // proteção de SSRF da URL original -- um servidor malicioso
    // poderia devolver 302 de uma URL pública pra um endereço interno.
    for (;;) {
      const parsedUrl = await assertUrlIsFetchable(currentUrl, {
        resolveHostname: this.resolveHostname,
        label: "web.fetch",
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        response = await this.fetchImpl(parsedUrl.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": "softload-worker-agent/1.0" },
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          throw new Error(`web.fetch: timeout após ${timeoutMs}ms buscando ${currentUrl}`);
        }

        throw new Error(`web.fetch: falha de rede buscando ${currentUrl}: ${(error as Error).message}`);
      } finally {
        clearTimeout(timer);
      }

      if (REDIRECT_STATUS_CODES.has(response.status)) {
        const location = response.headers.get("location");

        if (!location) {
          throw new Error(
            `web.fetch: resposta de redirecionamento (${response.status}) sem header Location`,
          );
        }

        redirectCount += 1;

        if (redirectCount > MAX_REDIRECTS) {
          throw new Error(`web.fetch: excedeu o limite de ${MAX_REDIRECTS} redirecionamentos`);
        }

        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      break;
    }

    const contentType = response.headers.get("content-type") || null;

    if (!isTextualContentType(contentType)) {
      throw new Error(
        `web.fetch só suporta conteúdo textual (HTML, texto, JSON, XML) -- recebido: ${contentType}`,
      );
    }

    const { text, bytesRead, truncated } = await readBodyWithCap(response, maxBytes);

    const content = isHtmlContentType(contentType)
      ? convert(text, { wordwrap: false })
      : text;

    return {
      url: currentUrl,
      status: response.status,
      ok: response.ok,
      contentType,
      content,
      bytes: bytesRead,
      truncated,
    };
  }
}

/**
 * Lê o corpo da resposta respeitando `maxBytes` -- streaming manual
 * (não `response.text()`, que carregaria o corpo inteiro na memória
 * ANTES de qualquer chance de cortar). Corta no meio de um chunk se
 * necessário e cancela o resto do stream, sinalizando `truncated`.
 */
async function readBodyWithCap(response: Response, maxBytes: number) {
  if (!response.body) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, "utf8");

    if (bytes <= maxBytes) {
      return { text, bytesRead: bytes, truncated: false };
    }

    return {
      text: Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8"),
      bytesRead: maxBytes,
      truncated: true,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let text = "";
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    received += value.byteLength;

    if (received > maxBytes) {
      const allowed = value.byteLength - (received - maxBytes);
      text += decoder.decode(value.subarray(0, allowed));
      truncated = true;
      received = maxBytes;
      await reader.cancel().catch(() => {});
      break;
    }

    text += decoder.decode(value, { stream: true });
  }

  return { text, bytesRead: received, truncated };
}
