import express from "express";
import { runWebSandbox } from "./webSandbox/index.js";
import { runArchiveExtract, runZipExtract } from "./archive/index.js";
import { MAX_MAX_COMPRESSED_BYTES } from "./archive/security.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("sandbox-efemero");

const PORT = process.env.PORT || 8080;

// Segredo compartilhado simples entre o agent principal e este
// serviço. Este container não guarda credenciais de git/GCP/workspace
// (esse é o ponto de tê-lo isolado), mas ainda assim não deveria
// aceitar requisições de qualquer origem caso o serviço fique
// acessível por engano fora da rede interna -- defesa em profundidade
// mínima, não a única camada (o ideal em produção é também restringir
// via IAM/rede do Cloud Run, ex: --no-allow-unauthenticated).
const SHARED_SECRET = process.env.SANDBOX_SHARED_SECRET;
if (!SHARED_SECRET) {
  logger.warn(
    "SANDBOX_SHARED_SECRET não configurado -- endpoint /run aceita qualquer chamador. " +
      "Configure a variável de ambiente antes de expor este serviço fora de um ambiente totalmente confiável.",
  );
}

const app = express();

// Limite de tamanho de corpo -- options.viewport/allowedHosts são
// pequenos; um corpo de requisição grande não tem motivo legítimo e
// só serviria para esgotar memória.
app.use(express.json({ limit: "64kb" }));

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

function requireSharedSecret(req, res, next) {
  if (!SHARED_SECRET) return next(); // aviso já emitido na subida
  const provided = req.get("x-sandbox-secret");
  if (provided !== SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

app.post("/run", requireSharedSecret, async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await runWebSandbox(req.body);
    logger.info("web sandbox run concluído", {
      url: result.url,
      success: result.success,
      durationMs: Date.now() - startedAt,
    });
    res.status(200).json(result);
  } catch (error) {
    // runWebSandbox captura seus próprios erros internamente e nunca
    // deveria rejeitar -- isto é uma rede de segurança para qualquer
    // falha inesperada fora do fluxo normal (ex: JSON malformado já
    // seria pego pelo express.json antes de chegar aqui).
    logger.error("Falha inesperada em /run", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "internal_error", message: error.message });
  }
});

// Converte um valor de query string (sempre string ou undefined) para
// number, ou undefined se ausente/inválido -- validateOptions()
// (security.js) já trata "ausente ou fora da faixa" caindo pro
// default, então um NaN aqui vira undefined e segue o mesmo caminho.
function queryInt(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// POST /extract-zip -- corpo é o BUFFER BRUTO do .zip (não JSON: um
// zip de poucos MB inteiro em base64 dentro de um campo JSON infla
// ~33% à toa e exigiria um limite de body muito maior só nesta rota).
// Opções de limite (compressed/files/fileBytes/totalBytes/depth/
// timeout) vêm via query string -- corpo pequeno, só os bytes do zip.
// `express.raw({ type: () => true })` aceita qualquer Content-Type
// (o zip pode chegar como application/zip, application/octet-stream,
// etc. -- não há um único valor correto), com teto de
// MAX_MAX_COMPRESSED_BYTES (mesma constante que validateOptions usa
// como teto de maxCompressedBytes -- fonte única, evita os dois
// limites divergirem).
app.post(
  "/extract-zip",
  requireSharedSecret,
  express.raw({ type: () => true, limit: MAX_MAX_COMPRESSED_BYTES }),
  async (req, res) => {
    const startedAt = Date.now();
    const zipBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    const result = await runZipExtract(zipBuffer, {
      maxFiles: queryInt(req.query.maxFiles),
      maxFileBytes: queryInt(req.query.maxFileBytes),
      maxTotalBytes: queryInt(req.query.maxTotalBytes),
      maxCompressedBytes: queryInt(req.query.maxCompressedBytes),
      maxDepth: queryInt(req.query.maxDepth),
      timeoutMs: queryInt(req.query.timeoutMs),
    });

    logger.info("archive extract-zip concluído", {
      success: result.success,
      totalArquivos: result.totalArquivos,
      durationMs: Date.now() - startedAt,
    });
    res.status(200).json(result);
  },
);

// Sucessor genérico de /extract-zip. A rota antiga continua para não
// quebrar clientes publicados; esta aceita RAR, 7z e TAR além de ZIP.
// `format=auto` é padrão; TAR legado/comprimido precisa de `format=tar`.
app.post(
  "/extract-archive",
  requireSharedSecret,
  express.raw({ type: () => true, limit: MAX_MAX_COMPRESSED_BYTES }),
  async (req, res) => {
    const startedAt = Date.now();
    const archiveBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await runArchiveExtract(archiveBuffer, {
      format: typeof req.query.format === "string" ? req.query.format : "auto",
      maxFiles: queryInt(req.query.maxFiles),
      maxFileBytes: queryInt(req.query.maxFileBytes),
      maxTotalBytes: queryInt(req.query.maxTotalBytes),
      maxCompressedBytes: queryInt(req.query.maxCompressedBytes),
      maxDepth: queryInt(req.query.maxDepth),
      timeoutMs: queryInt(req.query.timeoutMs),
    }, { runZipExtract });

    logger.info("archive extract-archive concluído", {
      success: result.success,
      totalArquivos: result.totalArquivos,
      durationMs: Date.now() - startedAt,
    });
    res.status(200).json(result);
  },
);

// Handler de erro do body parser (JSON malformado, ou corpo além do
// limite -- tanto o express.json (rota /run) quanto o express.raw
// (rota /extract-zip) reportam isso do mesmo jeito) -- sem isto, o
// express deixaria a stack trace vazar pra resposta em alguns setups.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    return res.status(400).json({ error: "invalid_request", message: err.message });
  }
  return next(err);
});

const server = app.listen(PORT, () => {
  logger.info(`sandbox-efemero ouvindo na porta ${PORT}`);
});

// Cloud Run envia SIGTERM antes de reciclar/encerrar uma instância.
// Sem handler, requisições em andamento (uma auditoria de navegador
// pode levar vários segundos) seriam derrubadas abruptamente.
function shutdown(signal) {
  logger.info(`${signal} recebido, encerrando sandbox-efemero...`);
  server.close(() => {
    logger.info("Servidor encerrado.");
    process.exit(0);
  });
  // Se close() não resolver a tempo (conexão pendurada), força saída.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
