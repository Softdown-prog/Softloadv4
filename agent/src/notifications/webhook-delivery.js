import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { assertUrlIsFetchable, defaultResolveHostname } from "../security/ssrf-guard.js";

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 30000;
const MAX_ERROR_SNIPPET_CHARS = 500;
const MIN_SECRET_LENGTH = 16;

/**
 * deliverWebhook: entrega HTTP POST assinada (HMAC-SHA256) pra uma URL
 * fornecida pelo CHAMADOR a cada requisição (não uma URL fixa
 * pré-configurada) — usado por `process.js` (notificação de processo
 * em background terminado) e, numa rodada futura, pelo canal de
 * escalonamento humano. Nenhum mecanismo de webhook de SAÍDA
 * reutilizável existia neste repositório antes desta função
 * (confirmado por auditoria antes de implementar — o único webhook de
 * saída existente é o do workflow de deploy do GitHub Actions, `curl`
 * direto num `.yml`, fora do código da aplicação).
 *
 * Entrega ÚNICA, sem retry automático — decisão deliberada, mesmo
 * critério já em uso nas próprias instruções de monitoramento de PR
 * desta sessão ("webhooks don't reliably deliver... don't rely on
 * events alone"): quem recebe o callback nunca deveria depender só
 * dele — o polling (`process.status`, por exemplo) continua sendo o
 * caminho confiável; o webhook é só uma otimização de latência, pra
 * não precisar ficar consultando. Adicionar retry/backoff aqui seria
 * complexidade real sem necessidade prática, dado que o polling já
 * cobre o caso de falha de entrega.
 *
 * Assinatura: HMAC-SHA256 do corpo JÁ SERIALIZADO (raw bytes, não do
 * objeto), no header `X-Softload-Webhook-Signature: sha256=<hex>` —
 * mesmo esquema de verificação usado por GitHub/Stripe/a maioria dos
 * provedores de webhook: `hmac(secret, rawBody) === assinatura`. Ver
 * `verifyWebhookSignature()` abaixo para o lado receptor.
 *
 * NUNCA segue redirecionamento (`redirect: "manual"` — qualquer 3xx
 * conta como falha de entrega) — um redirecionamento pra um host
 * arbitrário vazaria o payload assinado (que pode conter dados
 * sensíveis do processo/escalonamento) pra um destino não pretendido
 * pelo chamador original.
 *
 * NUNCA lança por falha de ENTREGA (rede, timeout, status não-2xx,
 * bloqueio de SSRF) — sempre devolve um resultado estruturado
 * `{delivered, statusCode, error}`, porque uma falha de entrega de
 * webhook não deveria derrubar o fluxo principal de quem chamou (ex:
 * `process.js` não deveria falhar a limpeza de um processo só porque
 * o receptor do callback estava fora do ar). Só lança por erro de
 * INPUT (`url`/`secret`/`payload` ausente ou inválido) — isso é bug
 * de quem chamou, não falha de entrega.
 */
export async function deliverWebhook({
  url,
  secret,
  payload,
  fetchImpl = fetch,
  resolveHostname = defaultResolveHostname,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("deliverWebhook exige url (string)");
  }

  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `deliverWebhook exige secret (string, mínimo ${MIN_SECRET_LENGTH} caracteres)`,
    );
  }

  if (payload === undefined) {
    throw new Error("deliverWebhook exige payload");
  }

  const effectiveTimeoutMs = Math.min(
    Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );

  const deliveryId = randomUUID();
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const attemptedAt = Date.now();

  let parsedUrl;

  try {
    parsedUrl = await assertUrlIsFetchable(url, { resolveHostname, label: "webhook" });
  } catch (error) {
    return {
      delivered: false,
      deliveryId,
      statusCode: null,
      error: error.message,
      attemptedAt,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  try {
    const response = await fetchImpl(parsedUrl.toString(), {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Softload-Webhook-Id": deliveryId,
        "X-Softload-Webhook-Signature": `sha256=${signature}`,
        "X-Softload-Webhook-Timestamp": new Date(attemptedAt).toISOString(),
      },
      body,
    });

    if (response.ok) {
      return {
        delivered: true,
        deliveryId,
        statusCode: response.status,
        error: null,
        attemptedAt,
      };
    }

    const snippet = await response.text().then(
      (text) => text.slice(0, MAX_ERROR_SNIPPET_CHARS),
      () => "",
    );

    return {
      delivered: false,
      deliveryId,
      statusCode: response.status,
      error: `resposta não-2xx (${response.status})${snippet ? `: ${snippet}` : ""}`,
      attemptedAt,
    };
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? `timeout após ${effectiveTimeoutMs}ms`
        : `falha de rede: ${error.message}`;

    return { delivered: false, deliveryId, statusCode: null, error: message, attemptedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifica a assinatura de um webhook RECEBIDO — pro lado receptor
 * (ex: um endpoint no app principal que recebe callbacks deste
 * agent/). Comparação em tempo constante (`timingSafeEqual`), mesmo
 * padrão já usado por `verificarSegredoRagBusca`/`verificarAssinaturaMP`
 * no app principal (`src/routes/apiRoutes.js`) — nunca `===` direto
 * numa string derivada de segredo.
 *
 * `rawBody` precisa ser o corpo EXATO recebido (string ou Buffer,
 * antes de qualquer `JSON.parse`) — a assinatura foi calculada sobre
 * os bytes exatos enviados por `deliverWebhook`, não sobre uma
 * reserialização do objeto já parseado (que pode diferir em
 * espaçamento/ordem de chaves e invalidar a comparação).
 */
export function verifyWebhookSignature({ secret, rawBody, signatureHeader }) {
  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  let providedBuffer;
  let expectedBuffer;

  try {
    providedBuffer = Buffer.from(provided, "hex");
    expectedBuffer = Buffer.from(expected, "hex");
  } catch {
    return false;
  }

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
