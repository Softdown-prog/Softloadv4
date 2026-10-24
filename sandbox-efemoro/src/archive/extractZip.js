import yauzl from "yauzl";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { validateOptions, hasDangerousExtension } from "./security.js";
import { positiveIntEnvOverride } from "../utils/envInt.js";

// ============================================================
// archive.extractZip -- extração segura de ZIP, isolada neste
// serviço (sandbox-efemoro/) em vez de rodar dentro do processo do
// Worker Agent. Lógica das duas fases PORTADA de
// src/solaris/tools/fileTools.js (extrairZip) do app principal --
// mesmo algoritmo já maduro e testado em produção lá, não reescrito
// do zero -- com três defesas NOVAS que fileTools.js não tinha:
//   1. limite explícito de tamanho COMPACTADO (fileTools.js só tinha
//      isso na borda do multer, no app principal, nunca dentro da
//      própria função de extração);
//   2. limite de profundidade de caminho;
//   3. rejeição EXPLÍCITA de entrada marcada como symlink (Unix mode
//      no externalFileAttributes do zip) -- fileTools.js nunca criava
//      um symlink real (grava bytes crus via createWriteStream, nunca
//      chama fs.symlink), então já era imune ao ataque clássico, mas
//      só por efeito colateral do design, nunca decidido explicitamente.
// Mais: timeout de wall-clock pra extração inteira, checagem de
// espaço em disco livre antes da Fase 2, e limpeza do diretório
// temporário garantida DENTRO da própria função (fileTools.js
// delegava isso ao chamador -- aqui não há chamador pra confiar, o
// diretório é criado e destruído inteiramente dentro desta função).
// ============================================================

/**
 * Resolve `caminhoRelativo` dentro de `baseDir`, garantindo que o
 * resultado não escapa do baseDir (path traversal) -- mesmo guard de
 * fileTools.js `_resolverSeguro`.
 */
function resolveSafe(baseDir, caminhoRelativo) {
  const baseAbs = path.resolve(baseDir);
  const alvoAbs = path.resolve(baseAbs, caminhoRelativo);
  if (alvoAbs !== baseAbs && !alvoAbs.startsWith(baseAbs + path.sep)) {
    throw new Error(`caminho "${caminhoRelativo}" escapa do diretório de destino -- recusado.`);
  }
  return alvoAbs;
}

// Unix file type bits ficam nos 16 bits superiores de
// externalFileAttributes (formato ZIP padrão, ver seção 4.4.15 da
// especificação); S_IFLNK = 0o120000, mascarado por S_IFMT = 0o170000.
function isSymlinkEntry(entry) {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return unixMode !== 0 && (unixMode & 0o170000) === 0o120000;
}

function pathDepth(fileName) {
  return fileName.split("/").filter(Boolean).length;
}

function listEntries(zipfile) {
  return new Promise((resolve, reject) => {
    const entries = [];
    let done = false;

    zipfile.on("error", (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
    zipfile.readEntry();
    zipfile.on("entry", (entry) => {
      if (done) return;
      entries.push(entry);
      zipfile.readEntry();
    });
    zipfile.on("end", () => {
      if (done) return;
      done = true;
      resolve(entries);
    });
  });
}

function extractEntry(zipfile, entry, targetAbs, maxFileBytes) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (errStream, readStream) => {
      if (errStream) {
        reject(new Error(`falha lendo a entrada "${entry.fileName}" -- ${errStream.message}`));
        return;
      }

      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      const writeStream = fs.createWriteStream(targetAbs);
      let bytesRead = 0;
      let finished = false;

      function fail(err) {
        if (finished) return;
        finished = true;
        readStream.destroy();
        writeStream.destroy();
        reject(err);
      }

      readStream.on("data", (chunk) => {
        bytesRead += chunk.length;
        // Defesa em profundidade: cabeçalho do zip pode mentir sobre
        // uncompressedSize -- só o byte count real durante a
        // descompressão pega isso de verdade.
        if (bytesRead > maxFileBytes) {
          fail(new Error(`arquivo "${entry.fileName}" excede o tamanho declarado no cabeçalho do zip -- recusado.`));
        }
      });
      readStream.on("error", (e) => fail(new Error(`erro extraindo "${entry.fileName}" -- ${e.message}`)));
      writeStream.on("error", (e) => fail(new Error(`erro gravando "${entry.fileName}" -- ${e.message}`)));
      writeStream.on("close", () => {
        if (finished) return;
        finished = true;
        resolve();
      });
      readStream.pipe(writeStream);
    });
  });
}

async function checkDiskSpace(dir, neededBytes) {
  try {
    const stats = await fsp.statfs(dir);
    const availableBytes = stats.bavail * stats.bsize;
    if (availableBytes < neededBytes) {
      throw new Error(
        `espaço em disco insuficiente para extrair (disponível: ${availableBytes} bytes, necessário: ${neededBytes} bytes).`,
      );
    }
  } catch (err) {
    // statfs pode não existir na plataforma/filesystem -- não é
    // motivo para bloquear a extração, só perdemos essa camada extra
    // de defesa (as outras -- tamanho total, contagem -- continuam).
    if (err.code === "ENOSYS" || err.syscall === "statfs") return;
    throw err;
  }
}

// Node's fs.readFile(path, "utf8") NUNCA lança por sequência de bytes
// inválida -- silenciosamente substitui por U+FFFD e "funciona"
// mesmo em binário puro (confirmado rodando isto de verdade, não só
// documentação). Então a detecção de binário precisa olhar os BYTES
// crus antes de decodificar -- mesma heurística usada por git/grep
// (presença de byte nulo nos primeiros bytes é um indicador forte;
// texto legítimo praticamente nunca contém \0).
const BINARY_SNIFF_BYTES = 8000;

function looksBinary(buffer) {
  const sampleSize = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

// Lê de volta cada arquivo extraído. Texto (heurística acima) vem com
// `conteudo` como string UTF-8; binário vem marcado, sem conteúdo
// embutido na resposta (evita inflar o corpo HTTP com base64 --
// fora de escopo desta primeira etapa, focada em projetos de texto).
async function readExtractedFiles(baseDir, relativePaths) {
  const arquivos = [];
  for (const relativo of relativePaths) {
    const abs = path.join(baseDir, relativo);
    const buffer = await fsp.readFile(abs);
    if (looksBinary(buffer)) {
      arquivos.push({ caminho: relativo, conteudo: null, binario: true });
    } else {
      arquivos.push({ caminho: relativo, conteudo: buffer.toString("utf8"), binario: false });
    }
  }
  return arquivos;
}

// ── Isolamento + teto de memória do processo de extração ───────────
//
// `extractInto` (abaixo) rodava, até esta revisão, diretamente no
// mesmo processo/thread do servidor Express -- um bug no yauzl, no
// zlib nativo, ou no próprio código deste arquivo podia derrubar o
// container inteiro, levando junto QUALQUER requisição concorrente na
// mesma instância (mesmo raciocínio do teto de bsdtar em
// extractArchive.js, ver comentário lá -- mas a solução aqui é
// DIFERENTE, ver nota importante abaixo).
//
// Solução: `extractInto` roda numa worker_thread DEDICADA por
// requisição (zipExtractWorker.js). Duas garantias distintas, que não
// devem ser confundidas:
//
// 1. ISOLAMENTO DE FALHA (garantido, incondicional): QUALQUER crash
//    dentro da worker -- estouro de heap, exceção não tratada, bug de
//    terceiros -- mata só aquela worker. O processo principal recebe
//    um evento "error" no objeto Worker e segue normalmente. Como
//    agora controlamos o objeto Worker, um timeout também pode chamar
//    `worker.terminate()` de verdade -- o antigo `withTimeout`
//    (Promise.race) só parava de ESPERAR a promise perdedora, sem
//    cancelar o trabalho em andamento, que continuava rodando
//    "zumbi" em segundo plano até terminar sozinho.
//
// 2. TETO DE MEMÓRIA via `resourceLimits.maxOldGenerationSizeMb`
//    (parcial, achado real testando isto de verdade): só conta
//    memória do HEAP GERENCIADO DO V8 -- arrays, strings, objetos JS
//    comuns. Buffer/ArrayBuffer (ex: o próprio `zipBuffer`, e o
//    conteúdo dos arquivos extraídos conforme streamam) são alocados
//    FORA do heap do V8 (memória "externa", via malloc) e NÃO contam
//    pra esse teto -- confirmado experimentalmente: uma worker
//    alocando centenas de MB via `Buffer.alloc()` sob um teto de
//    heap de 200MB não foi barrada pelo V8 (só um teto de MEMÓRIA
//    VIRTUAL DO PROCESSO -- ex: `ulimit -v`, como usado pro bsdtar em
//    extractArchive.js -- pegaria isso; mas um processo Node completo
//    precisa de centenas de MB de espaço de endereçamento só pra
//    inicializar o V8, então essa técnica não é viável aqui do jeito
//    que é pro bsdtar, um binário C enxuto). Ou seja: quem
//    efetivamente limita o tamanho de conteúdo/Buffer aqui continua
//    sendo a contagem de bytes em tempo real já existente em
//    `extractEntry()` (aborta no instante em que `bytesRead` ultrapassa
//    `maxFileBytes`, sem mudança nesta revisão) -- `maxOldGenerationSizeMb`
//    é defesa em profundidade especificamente contra crescimento
//    descontrolado do lado JS (ex: um bug de lógica que acumula
//    objetos sem parar), não um substituto pra essa contagem.
const DEFAULT_ZIP_WORKER_MAX_OLD_GEN_MB = 512;
const ZIP_WORKER_PATH = fileURLToPath(new URL("./zipExtractWorker.js", import.meta.url));

// Lido a cada chamada, não uma vez no import -- mesmo padrão de
// `bsdtarMemoryLimitKb()` em extractArchive.js: permite provar em
// teste que o teto realmente mata uma worker, e ajustar por ambiente
// sem rebuild.
function zipWorkerMaxOldGenMb() {
  return positiveIntEnvOverride("SANDBOX_ZIP_WORKER_MEMORY_LIMIT_MB", DEFAULT_ZIP_WORKER_MAX_OLD_GEN_MB);
}

/**
 * Roda `extractInto(baseDir, zipBuffer, opts)` isolado numa
 * worker_thread com teto de memória próprio, aplicando `timeoutMs`
 * com cancelamento REAL (`worker.terminate()`) em vez de só parar de
 * esperar. Nunca reaproveita a worker entre chamadas -- criada e
 * terminada dentro desta função, mesmo padrão de "criado e destruído
 * numa única chamada" já usado para `baseDir` (mkdtemp/rm) e para
 * cada processo bsdtar em extractArchive.js.
 *
 * @returns {Promise<Array>} a mesma lista que `extractInto` devolveria diretamente.
 */
// Achado real de uma revisão pós-implementação: `workerData` usa o
// algoritmo de clone estruturado por padrão, que faz uma CÓPIA
// completa do `zipBuffer` (até `maxCompressedBytes`, hoje até 100MB)
// -- síncrono, na própria thread principal do Express, bloqueando
// todas as outras requisições concorrentes durante a cópia e dobrando
// o pico de memória (original + cópia) pelo tempo que ela leva.
// Exatamente o tipo de custo que este isolamento por worker deveria
// EVITAR, não introduzir.
//
// `transferList` resolveria isso com zero cópia -- mas SÓ é seguro
// transferir `buffer.buffer` inteiro quando esse ArrayBuffer pertence
// EXCLUSIVAMENTE a este Buffer (nenhum outro Buffer é uma fatia do
// mesmo ArrayBuffer). Buffers pequenos (abaixo de `Buffer.poolSize /
// 2`, 4096 bytes por padrão) costumam ser fatias do pool interno do
// Node -- transferir o ArrayBuffer inteiro nesse caso destacaria
// (detach) memória que outras alocações não relacionadas ainda podem
// estar usando, corrompendo dados por baixo dos panos. `zipBuffer`
// aqui quase sempre é grande o bastante pra já ter sido alocado como
// um ArrayBuffer dedicado (Buffer.concat()/allocUnsafe() só usa o
// pool abaixo desse teto) -- byteOffset 0 e byteLength igual ao do
// ArrayBuffer subjacente é o sinal seguro de "não é uma fatia
// compartilhada". Só transferimos nesse caso; do contrário caímos de
// volta pro clone estruturado (seguro, e o custo é desprezível pra um
// buffer já pequeno).
function toWorkerZipBufferTransfer(zipBuffer) {
  const isDedicatedArrayBuffer =
    zipBuffer.byteOffset === 0 && zipBuffer.byteLength === zipBuffer.buffer.byteLength;

  return isDedicatedArrayBuffer
    ? { zipBufferForWorker: zipBuffer.buffer, transferList: [zipBuffer.buffer] }
    : { zipBufferForWorker: zipBuffer, transferList: [] };
}

function runZipExtractInWorker(baseDir, zipBuffer, opts, timeoutMs) {
  return new Promise((resolve, reject) => {
    let worker;
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Sempre libera a OS thread assim que temos uma resposta
      // (sucesso, erro ou timeout) -- sem isto, cada requisição
      // vazaria uma worker_thread nunca terminada. Chamar terminate()
      // numa worker que já saiu sozinha é um no-op seguro.
      worker?.terminate().catch(() => {});
      fn(value);
    };

    const timer = setTimeout(() => {
      settle(reject, new Error(`extração excedeu o tempo limite de ${timeoutMs}ms.`));
    }, timeoutMs);

    try {
      const { zipBufferForWorker, transferList } = toWorkerZipBufferTransfer(zipBuffer);
      worker = new Worker(ZIP_WORKER_PATH, {
        workerData: { baseDir, zipBuffer: zipBufferForWorker, opts },
        transferList,
        resourceLimits: { maxOldGenerationSizeMb: zipWorkerMaxOldGenMb() },
      });
    } catch (err) {
      settle(reject, err);
      return;
    }

    worker.once("message", (msg) => {
      if (msg.ok) settle(resolve, msg.arquivos);
      else settle(reject, new Error(msg.message));
    });

    worker.once("error", (err) => {
      // V8 mata a worker por estourar resourceLimits com um "error"
      // cuja mensagem menciona limite de memória/heap -- distinguir
      // esse caso de um erro comum ajuda quem chama a agir diferente
      // (ex: não faz sentido tentar de novo com o mesmo zip).
      const estourouMemoria = /heap out of memory|memory limit/i.test(err.message || "");
      settle(
        reject,
        estourouMemoria
          ? new Error(
              `extração abortada -- excedeu o limite de memória de ${zipWorkerMaxOldGenMb()}MB reservado para esta operação.`,
            )
          : err,
      );
    });

    worker.once("exit", (code) => {
      // Só chega aqui sem settled se a worker encerrou sem emitir
      // "message" nem "error" antes -- caso raro (ex: um bug interno
      // matando a thread silenciosamente). Depois de resolve/reject
      // já ter acontecido, "exit" ainda dispara (terminate() causa
      // saída), mas settle() vira no-op nesse caso.
      settle(reject, new Error(`worker de extração encerrou inesperadamente (código ${code}).`));
    });
  });
}

async function extractInto(baseDir, zipBuffer, opts) {
  const zipfile = await new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zf) => {
      if (err) reject(new Error(`zip inválido ou corrompido -- ${err.message}`));
      else resolve(zf);
    });
  });

  try {
    const allEntries = await listEntries(zipfile);

    // ── Fase 1: validação completa, zero escrita em disco ──────────
    const files = [];
    let totalBytes = 0;
    for (const entry of allEntries) {
      if (/\/$/.test(entry.fileName)) continue; // diretório -- não conta como arquivo

      const nameError = yauzl.validateFileName(entry.fileName);
      if (nameError) {
        throw new Error(
          `entrada "${entry.fileName}" com nome inválido (${nameError}) -- possível zip-slip, zip inteiro recusado.`,
        );
      }

      if (isSymlinkEntry(entry)) {
        throw new Error(`entrada "${entry.fileName}" é um symlink -- recusado por segurança, zip inteiro rejeitado.`);
      }

      if (hasDangerousExtension(entry.fileName)) {
        throw new Error(
          `entrada "${entry.fileName}" tem extensão perigosa (executável/script do Windows, Office com macro, ou arquivo .env) -- recusado por segurança, zip inteiro rejeitado.`,
        );
      }

      const depth = pathDepth(entry.fileName);
      if (depth > opts.maxDepth) {
        throw new Error(`entrada "${entry.fileName}" excede a profundidade máxima de ${opts.maxDepth} níveis.`);
      }

      if (files.length + 1 > opts.maxFiles) {
        throw new Error(`mais de ${opts.maxFiles} arquivos no zip -- recusado (limite de segurança).`);
      }

      if (entry.uncompressedSize > opts.maxFileBytes) {
        throw new Error(
          `arquivo "${entry.fileName}" (${entry.uncompressedSize} bytes declarados) excede o limite de ${opts.maxFileBytes} bytes por arquivo.`,
        );
      }

      totalBytes += entry.uncompressedSize;
      if (totalBytes > opts.maxTotalBytes) {
        throw new Error(`total descomprimido excede ${opts.maxTotalBytes} bytes -- recusado (proteção contra zip bomb).`);
      }

      const targetAbs = resolveSafe(baseDir, entry.fileName);
      files.push({ entry, targetAbs, relative: entry.fileName });
    }

    await checkDiskSpace(baseDir, totalBytes);

    // ── Fase 2: zip inteiro validado -- agora sim extrai de verdade ──
    const extracted = [];
    for (const { entry, targetAbs, relative } of files) {
      await extractEntry(zipfile, entry, targetAbs, opts.maxFileBytes);
      extracted.push(relative);
    }

    return readExtractedFiles(baseDir, extracted.sort());
  } finally {
    zipfile.close();
  }
}

/**
 * Extrai um ZIP (Buffer) com validação em duas fases + limites de
 * segurança, sempre num diretório temporário próprio (criado e
 * destruído inteiramente dentro desta função -- nunca sobrevive além
 * de uma chamada). Nunca lança: qualquer falha (entrada inválida,
 * zip malicioso, timeout, disco cheio) volta como
 * `{success:false, errors:[...]}` dentro do resultado -- mesmo
 * contrato de runWebSandbox (ver webSandbox/runner.js), pra quem
 * chama (server.js) sempre poder responder 200 com um corpo
 * estruturado, sem precisar de try/catch.
 *
 * @param {Buffer} zipBuffer
 * @param {object} [options]
 * @returns {Promise<{success:boolean, arquivos:Array, totalArquivos:number, duration:number, errors:Array}>}
 */
async function runArchiveExtract(zipBuffer, options = {}) {
  const startTime = Date.now();
  const result = {
    success: false,
    arquivos: [],
    totalArquivos: 0,
    duration: 0,
    errors: [],
  };

  const opts = validateOptions(options);

  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
    result.errors.push({ message: "zip vazio ou inválido." });
    result.duration = Date.now() - startTime;
    return result;
  }

  if (zipBuffer.length > opts.maxCompressedBytes) {
    result.errors.push({
      message: `zip compactado (${zipBuffer.length} bytes) excede o limite de ${opts.maxCompressedBytes} bytes.`,
    });
    result.duration = Date.now() - startTime;
    return result;
  }

  const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "archive-extract-"));

  try {
    result.arquivos = await runZipExtractInWorker(baseDir, zipBuffer, opts, opts.timeoutMs);
    result.totalArquivos = result.arquivos.length;
    result.success = true;
  } catch (err) {
    result.success = false;
    result.errors.push({ message: err.message });
  } finally {
    await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => {});
    result.duration = Date.now() - startTime;
  }

  return result;
}

// checkDiskSpace/runZipExtractInWorker/toWorkerZipBufferTransfer
// exportados só para teste direto e determinístico dessas defesas em
// isolamento (ver extractZip.test.js) -- runArchiveExtract continua
// sendo a única função pensada para uso real fora deste módulo.
// `extractInto` é exportado só porque zipExtractWorker.js precisa
// importá-lo (roda DENTRO da worker_thread) -- não é pensado para uso
// direto fora desses dois arquivos.
export {
  runArchiveExtract,
  checkDiskSpace,
  runZipExtractInWorker,
  extractInto,
  toWorkerZipBufferTransfer,
};
