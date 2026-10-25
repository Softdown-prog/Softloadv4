// Validação de entrada da capability archive.extractZip. Ponto único
// por onde toda opção externa passa antes de tocar o yauzl/filesystem
// -- mesmo padrão de webSandbox/security.js (clamp pro default em vez
// de rejeitar a requisição inteira por um número fora da faixa; só o
// buffer do zip em si, validado em extractZip.js, pode rejeitar de
// verdade).

export interface ArchiveLimitsInput {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxCompressedBytes?: number;
  maxDepth?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_FILES = 300;
const MAX_MAX_FILES = 5000;

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB por arquivo
const MAX_MAX_FILE_BYTES = 50 * 1024 * 1024;

const DEFAULT_MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 30MB descomprimido, total
const MAX_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

// Tamanho do .zip em si (compactado) -- checado ANTES de abrir o
// buffer como zip, na borda HTTP (server.js) e de novo aqui como
// defesa em profundidade.
const DEFAULT_MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_MAX_COMPRESSED_BYTES = 100 * 1024 * 1024;

// Profundidade máxima de diretórios de uma entrada (ex: "a/b/c.txt"
// tem profundidade 3) -- protege contra árvores patologicamente
// aninhadas, mesmo dentro dos limites de contagem/tamanho.
const DEFAULT_MAX_DEPTH = 12;
const MAX_MAX_DEPTH = 32;

const DEFAULT_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;

function clampedInt(value: number | undefined, { def, min = 1, max }: { def: number; min?: number; max: number }): number {
  if (Number.isInteger(value) && (value as number) >= min && (value as number) <= max) {
    return value as number;
  }
  return def;
}

// Denylist fixa de extensões sem uso legítimo dentro de um projeto de
// template/site (o escopo real desta capability -- ver README) e com
// alto valor como vetor de malware/dropper ou vazamento de segredo:
// executáveis e scripts do Windows (o SO mais comum de quem baixaria
// um zip extraído por este serviço) e formatos do Office com macro.
// Compartilhada entre extractZip.js (ZIP) e extractArchive.js
// (RAR/7z/TAR) -- mesma regra nos dois formatos, um lugar só pra
// manter a lista.
const DANGEROUS_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".exe",
  ".pif",
  ".scr",
  ".lnk",
  ".vbs",
  ".wsf",
  ".hta",
  ".docm",
  ".xlsm",
]);

/**
 * Recusa a entrada se o NOME do arquivo (sem o caminho) tiver uma
 * extensão perigosa, ou for exatamente um arquivo `.env`. Comparação
 * case-insensitive (zips/RAR podem guardar `.EXE`, `.Exe`, etc).
 *
 * De propósito, SÓ o nome exato `.env` -- não `.env.local`/
 * `.env.production`/etc por prefixo. Variantes como `.env.example`/
 * `.env.sample` são convenção comum de TEMPLATE sem segredo real,
 * frequentemente versionadas no próprio repositório -- um match por
 * prefixo bloquearia essas de propósito legítimo junto com as
 * arriscadas, sem necessidade (o pedido original foi por `.env`
 * especificamente).
 *
 * Só olha pra BASE do nome (`fileName.split("/").pop()`) -- um
 * diretório no meio do caminho chamado, por acidente, "malware.exe/"
 * não deveria disparar isso; só o arquivo final importa.
 *
 * @param {string} fileName caminho da entrada dentro do arquivo compactado
 * @returns {boolean}
 */
function hasDangerousExtension(fileName: string): boolean {
  const base = fileName.split("/").pop()!.toLowerCase();

  if (base === ".env") {
    return true;
  }

  const dotIndex = base.lastIndexOf(".");
  if (dotIndex <= 0) {
    // Sem extensão, ou um dotfile comum (".gitignore", ".editorconfig")
    // -- fora do escopo desta denylist.
    return false;
  }

  return DANGEROUS_EXTENSIONS.has(base.slice(dotIndex));
}

/**
 * Valida e normaliza as opções de entrada (tipicamente vindas de
 * query string, já convertidas para number pelo chamador -- ver
 * server.js).
 * @param {object} options
 * @returns {object} Opções validadas.
 */
function validateOptions(options: ArchiveLimitsInput | null | undefined) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Options object is required");
  }

  return {
    maxFiles: clampedInt(options.maxFiles, { def: DEFAULT_MAX_FILES, max: MAX_MAX_FILES }),
    maxFileBytes: clampedInt(options.maxFileBytes, { def: DEFAULT_MAX_FILE_BYTES, max: MAX_MAX_FILE_BYTES }),
    maxTotalBytes: clampedInt(options.maxTotalBytes, { def: DEFAULT_MAX_TOTAL_BYTES, max: MAX_MAX_TOTAL_BYTES }),
    maxCompressedBytes: clampedInt(options.maxCompressedBytes, { def: DEFAULT_MAX_COMPRESSED_BYTES, max: MAX_MAX_COMPRESSED_BYTES }),
    maxDepth: clampedInt(options.maxDepth, { def: DEFAULT_MAX_DEPTH, max: MAX_MAX_DEPTH }),
    timeoutMs: clampedInt(options.timeoutMs, { def: DEFAULT_TIMEOUT_MS, min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS }),
  };
}

// Exportado para server.js usar como teto do body parser (express.raw)
// da rota /extract-zip -- fonte única, evita que os dois limites (o
// do parser HTTP e o desta validação) fiquem dessincronizados.
export { validateOptions, MAX_MAX_COMPRESSED_BYTES, hasDangerousExtension };
