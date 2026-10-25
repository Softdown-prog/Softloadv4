import { spawn } from "node:child_process";
import type { ArchiveLimitsInput } from "./security.js";

type ArchiveOpts = ReturnType<typeof validateOptions>;
type ArchiveFormat = "zip" | "rar" | "7z" | "tar";
export interface ExtractedArchiveFile { caminho: string; conteudo: string | null; binario: boolean }
export interface ArchiveExtractResult {
  success: boolean;
  arquivos: ExtractedArchiveFile[];
  totalArquivos: number;
  duration: number;
  errors: Array<{ message: string }>;
}
interface ExtractArchiveOptions extends ArchiveLimitsInput { format?: string }

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkDiskSpace } from "./extractZip.js";
import { validateOptions, hasDangerousExtension } from "./security.js";
import { positiveIntEnvOverride } from "../utils/envInt.js";

// RAR, 7z e TAR são lidos por libarchive (via bsdtar), uma biblioteca
// madura que reconhece automaticamente filtros como gzip/xz e suporta
// RAR5 e 7-Zip. Não há parser de formato escrito neste projeto.
//
// A integração nunca pede ao bsdtar para extrair em um diretório: cada
// entrada validada é enviada ao stdout, limitada em bytes reais e guardada
// somente na memória da requisição. Assim, ela não cria links ou devices.
const BSDTAR_PATH = process.env.SANDBOX_BSDTAR_PATH || "/usr/bin/bsdtar";
const LIST_OUTPUT_LIMIT = 4 * 1024 * 1024;
const STDERR_LIMIT = 16 * 1024;
const BINARY_SNIFF_BYTES = 8000;

// ── Teto de memória/CPU do processo bsdtar (nível de container) ────
//
// O timeout de wall-clock + limite de bytes de saída (maxOutputBytes,
// abaixo) já existiam, mas nenhum dos dois impede que o bsdtar em si
// aloque memória sem limite ANTES de produzir qualquer byte de saída
// (ex: um arquivo com uma razão de compressão patológica pode fazer
// libarchive alocar um buffer de descompressão gigante internamente).
// Sem um teto do SISTEMA OPERACIONAL, isso pode derrubar o container
// inteiro (OOM kill do Cloud Run) -- levando junto QUALQUER outra
// requisição concorrente na mesma instância (ex: uma auditoria de
// navegador rodando ao mesmo tempo).
//
// Solução: RLIMIT_AS (memória virtual) e RLIMIT_CPU (segundos de CPU
// consumidos, não wall-clock) via `ulimit`, builtin POSIX de shell --
// funciona em QUALQUER container não-privilegiado (ao contrário de
// cgroups, que normalmente exigem CAP_SYS_ADMIN, indisponível no
// Cloud Run), sem nenhuma dependência nova. O bsdtar é executado como
// filho de um `/bin/sh -c` que aplica os limites em si mesmo ANTES do
// `exec` (que substitui o processo do shell pelo bsdtar, herdando os
// limites já aplicados) -- validado manualmente que um limite de
// memória baixo demais faz o próprio carregador dinâmico falhar de
// forma limpa (exit 127), nunca um crash do processo pai.
//
// Todo valor sensível (caminho do bsdtar, argumentos, limites) viaja
// como elemento SEPARADO de argv para o `/bin/sh -c script $0 $1 ...`
// -- nunca interpolado dentro do texto do script -- então não há
// risco de injeção de shell mesmo com nomes de entrada de arquivo
// contendo caracteres especiais (a defesa de segurança de verdade
// contra isso já existe em normalizeEntryPath()).
const SHELL_PATH = process.env.SANDBOX_SHELL_PATH || "/bin/sh";
const DEFAULT_BSDTAR_MEMORY_LIMIT_KB = 512 * 1024; // 512MB de memória virtual
// RLIMIT_CPU conta segundos de CPU realmente consumidos, não
// wall-clock -- pode ficar bem abaixo do timeout em operações com
// espera de I/O. Uma margem por cima do timeout de wall-clock evita
// que o RLIMIT_CPU dispare antes (e com uma mensagem menos clara) do
// que o timeout já existente seria a causa mais provável na prática.
const BSDTAR_CPU_GRACE_SECONDS = 5;
// Exit code reservado do WRAPPER em si (nunca vindo do bsdtar/exec) --
// só usado quando o `ulimit` falha antes de sequer chegar no `exec`.
const ULIMIT_FAILURE_EXIT_CODE = 99;
// Achado real (rodada de revisão pós-implementação): a versão
// anterior deste script usava `;` entre os `ulimit` e o `exec`, com
// stderr descartado (`2>/dev/null`) -- se `ulimit -v`/`ulimit -t`
// falhasse por QUALQUER motivo (ex: comportamento diferente do kernel/
// sandbox do ambiente de produção vs. o usado pra validar manualmente
// aqui), a execução seguia em frente e rodava o bsdtar SEM NENHUM
// limite aplicado, silenciosamente -- exatamente o cenário que este
// mecanismo existe pra evitar, sem nenhum sinal de que a proteção não
// entrou em vigor. Agora: `&&` entre os dois `ulimit` (qualquer falha
// interrompe a cadeia ANTES do `exec`), erro visível em stderr (nunca
// mais descartado) e um exit code próprio e reservado
// (ULIMIT_FAILURE_EXIT_CODE) que runBsdTar() abaixo reconhece e traduz
// numa mensagem específica -- nunca mais "roda sem proteção e ninguém
// percebe".
const ULIMIT_WRAPPER_SCRIPT =
  'ulimit -v "$1" && ulimit -t "$2" || { ' +
  `echo "sandbox-efemero: falha ao aplicar ulimit de memoria/CPU -- recusando executar sem os limites" >&2; exit ${ULIMIT_FAILURE_EXIT_CODE}; ` +
  '}; shift 2; exec "$@"';

// Lido a cada chamada (não uma vez no import) -- permite override em
// teste (prova que o teto realmente barra uma extração, configurando
// um limite absurdamente baixo) sem precisar recarregar o módulo,
// mesmo padrão já usado em agent/src/utils/diff-patch-engine.js para
// DIFF_PATCH_ENGINE_BIN. Em produção, útil também pra ajustar o teto
// por ambiente sem rebuild.
function bsdtarMemoryLimitKb(): number {
  return positiveIntEnvOverride("SANDBOX_BSDTAR_MEMORY_LIMIT_KB", DEFAULT_BSDTAR_MEMORY_LIMIT_KB);
}

function looksBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sampleSize; i++) if (buffer[i] === 0) return true;
  return false;
}

function hasPrefix(buffer: Buffer, bytes: number[]): boolean {
  return buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
}

/** TAR V7 e TAR comprimido precisam de `format=tar`: sem nome do arquivo
 * no HTTP, eles não têm uma assinatura confiável para a detecção automática. */
function detectArchiveFormat(buffer: Buffer, requestedFormat: string = "auto"): ArchiveFormat {
  const allowedFormats = new Set(["auto", "zip", "rar", "7z", "tar"]);
  if (!allowedFormats.has(requestedFormat)) throw new Error(`formato de arquivo não suportado: "${requestedFormat}".`);

  let detected: ArchiveFormat | null = null;
  if (hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06])) detected = "zip";
  else if (hasPrefix(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]) || hasPrefix(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])) detected = "rar";
  else if (hasPrefix(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) detected = "7z";
  else if (buffer.length >= 262 && buffer.subarray(257, 262).toString("ascii") === "ustar") detected = "tar";

  if (requestedFormat === "auto") {
    if (detected) return detected;
    throw new Error("não foi possível identificar o formato; para TAR legado ou TAR comprimido informe format=tar.");
  }
  if (requestedFormat !== "tar" && detected !== requestedFormat) {
    throw new Error(`o conteúdo não corresponde ao formato declarado "${requestedFormat}".`);
  }
  return requestedFormat as ArchiveFormat;
}

function normalizeEntryPath(entryPath: string, opts: ArchiveOpts): string {
  if (typeof entryPath !== "string" || entryPath.length === 0 || entryPath.includes("\0")) throw new Error("arquivo contém um caminho vazio ou inválido.");
  // Padronizar para POSIX e recusar barras invertidas impede que um nome
  // aparentemente seguro no Linux vire traversal ao ser salvo no Windows.
  if (entryPath.includes("\\")) throw new Error(`entrada "${entryPath}" usa barra invertida e foi recusada por segurança.`);
  if (entryPath.startsWith("/") || /^[a-zA-Z]:/.test(entryPath) || entryPath.startsWith("-")) throw new Error(`entrada "${entryPath}" usa caminho absoluto ou ambíguo.`);
  const parts = entryPath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Error(`entrada "${entryPath}" tenta escapar do diretório de destino.`);
  if (parts.length > opts.maxDepth) throw new Error(`entrada "${entryPath}" excede a profundidade máxima de ${opts.maxDepth} níveis.`);
  if (hasDangerousExtension(entryPath)) {
    throw new Error(
      `entrada "${entryPath}" tem extensão perigosa (executável/script do Windows, Office com macro, ou arquivo .env) -- recusado por segurança, pacote inteiro rejeitado.`,
    );
  }
  return entryPath;
}

function trimErrorOutput(stderr: Buffer): string {
  const message = stderr.toString("utf8").trim();
  return message ? ` -- ${message.slice(0, STDERR_LIMIT)}` : "";
}

function runBsdTar(args: string[], { timeoutMs, maxOutputBytes }: { timeoutMs: number; maxOutputBytes: number }): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    const cpuLimitSeconds = Math.ceil(timeoutMs / 1000) + BSDTAR_CPU_GRACE_SECONDS;
    const wrappedArgs = [
      "-c",
      ULIMIT_WRAPPER_SCRIPT,
      "sandbox-bsdtar-wrapper",
      String(bsdtarMemoryLimitKb()),
      String(cpuLimitSeconds),
      BSDTAR_PATH,
      ...args,
    ];
    try {
      child = spawn(SHELL_PATH, wrappedArgs, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error: Error | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = (error: Error) => {
      if (settled) return;
      child.kill("SIGKILL");
      finish(error);
    };
    const timer = setTimeout(() => abort(new Error(`extração excedeu o tempo limite de ${timeoutMs}ms.`)), timeoutMs);
    child.on("error", (error) => {
      // ENOENT aqui é sobre o SHELL_PATH (/bin/sh), não mais sobre o
      // bsdtar diretamente -- ele agora é executado DENTRO do wrapper
      // (ver ULIMIT_WRAPPER_SCRIPT). bsdtar ausente/quebrado surge
      // via "close" abaixo (exec falha dentro do script, exit != 0,
      // stderr do shell já vem anexado à mensagem).
      if (error.code === "ENOENT") finish(new Error(`shell "${SHELL_PATH}" não encontrado no sandbox -- necessário para aplicar os limites de memória/CPU do bsdtar.`));
      else finish(error);
    });
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) abort(new Error(`arquivo extraído excede o limite de ${maxOutputBytes} bytes.`));
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= STDERR_LIMIT) return;
      const limited = chunk.subarray(0, STDERR_LIMIT - stderrBytes);
      stderrBytes += limited.length;
      stderr.push(limited);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      const stderrBuffer = Buffer.concat(stderr);
      if (code === ULIMIT_FAILURE_EXIT_CODE) {
        finish(new Error(`não foi possível aplicar o limite de memória/CPU (ulimit) antes de rodar o bsdtar -- extração recusada por segurança${trimErrorOutput(stderrBuffer)}`));
        return;
      }
      if (code !== 0) {
        finish(new Error(`libarchive recusou ou não conseguiu ler o arquivo (código ${code}${signal ? `, sinal ${signal}` : ""})${trimErrorOutput(stderrBuffer)}`));
        return;
      }
      finish(null, Buffer.concat(stdout));
    });
  });
}

function listTypeMarkers(verboseList: Buffer, expectedEntries: number): string[] {
  const lines = verboseList.toString("utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length !== expectedEntries) throw new Error("a listagem detalhada do arquivo é inconsistente; extração recusada.");
  return lines.map((line) => line[0]);
}

async function extractWithLibarchive(archiveBuffer: Buffer, opts: ArchiveOpts): Promise<ExtractedArchiveFile[]> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-libarchive-"));
  const archivePath = path.join(baseDir, "upload.archive");
  const deadline = Date.now() + opts.timeoutMs;
  const remainingTime = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`extração excedeu o tempo limite de ${opts.timeoutMs}ms.`);
    return remaining;
  };
  try {
    await checkDiskSpace(baseDir, archiveBuffer.length);
    await fs.writeFile(archivePath, archiveBuffer, { flag: "wx" });
    const namesBuffer = await runBsdTar(["-tf", archivePath], { timeoutMs: remainingTime(), maxOutputBytes: LIST_OUTPUT_LIMIT });
    const rawNames = namesBuffer.toString("utf8");
    if (rawNames.length === 0) return [];
    if (!rawNames.endsWith("\n")) throw new Error("a listagem do arquivo não possui separador seguro de entradas.");
    const names = rawNames.slice(0, -1).split(/\r?\n/);
    const verboseList = await runBsdTar(["-tvf", archivePath], { timeoutMs: remainingTime(), maxOutputBytes: LIST_OUTPUT_LIMIT });
    const types = listTypeMarkers(verboseList, names.length);

    const files: ExtractedArchiveFile[] = [];
    let totalBytes = 0;
    for (let index = 0; index < names.length; index++) {
      const type = types[index];
      if (type === "d") continue;
      if (type !== "-") throw new Error(`entrada "${names[index]}" tem tipo inseguro (${type || "desconhecido"}); links e devices são recusados.`);
      const relativePath = normalizeEntryPath(names[index], opts);
      if (files.length + 1 > opts.maxFiles) throw new Error(`mais de ${opts.maxFiles} arquivos no pacote -- recusado.`);
      const content = await runBsdTar(["-xOf", archivePath, "--", relativePath], { timeoutMs: remainingTime(), maxOutputBytes: opts.maxFileBytes });
      totalBytes += content.length;
      if (totalBytes > opts.maxTotalBytes) throw new Error(`total descomprimido excede ${opts.maxTotalBytes} bytes -- recusado (proteção contra archive bomb).`);
      const binario = looksBinary(content);
      files.push({ caminho: relativePath, conteudo: binario ? null : content.toString("utf8"), binario });
    }
    return files.sort((a, b) => a.caminho.localeCompare(b.caminho));
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** ZIP mantém yauzl e sua validação em duas fases; os formatos adicionais
 * passam por libarchive e nunca são materializados no filesystem. */
async function runArchiveExtract(
  archiveBuffer: unknown,
  options: ExtractArchiveOptions = {},
  { runZipExtract }: { runZipExtract?: (buffer: Buffer, opts: ArchiveOpts) => Promise<ArchiveExtractResult> } = {},
): Promise<ArchiveExtractResult> {
  const startTime = Date.now();
  const result: ArchiveExtractResult = { success: false, arquivos: [], totalArquivos: 0, duration: 0, errors: [] };
  try {
    const opts = validateOptions(options);
    if (!Buffer.isBuffer(archiveBuffer) || archiveBuffer.length === 0) throw new Error("arquivo compactado vazio ou inválido.");
    if (archiveBuffer.length > opts.maxCompressedBytes) throw new Error(`arquivo compactado (${archiveBuffer.length} bytes) excede o limite de ${opts.maxCompressedBytes} bytes.`);
    const format = detectArchiveFormat(archiveBuffer, options.format || "auto");
    if (format === "zip") {
      if (typeof runZipExtract !== "function") throw new Error("extrator ZIP não configurado.");
      return runZipExtract(archiveBuffer, opts);
    }
    result.arquivos = await extractWithLibarchive(archiveBuffer, opts);
    result.totalArquivos = result.arquivos.length;
    result.success = true;
  } catch (error) {
    result.errors.push({ message: (error as Error).message });
  }
  result.duration = Date.now() - startTime;
  return result;
}

// SHELL_PATH/ULIMIT_WRAPPER_SCRIPT/ULIMIT_FAILURE_EXIT_CODE exportados
// só pra teste direto e determinístico do mecanismo de ulimit em
// isolamento (ver extractArchive.test.js) -- runArchiveExtract
// continua sendo a única função pensada pra uso real fora deste
// módulo.
export {
  detectArchiveFormat,
  normalizeEntryPath,
  runArchiveExtract,
  SHELL_PATH,
  ULIMIT_WRAPPER_SCRIPT,
  ULIMIT_FAILURE_EXIT_CODE,
};
