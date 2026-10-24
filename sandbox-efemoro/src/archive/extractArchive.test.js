import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectArchiveFormat,
  normalizeEntryPath,
  runArchiveExtract,
  SHELL_PATH,
  ULIMIT_WRAPPER_SCRIPT,
  ULIMIT_FAILURE_EXIT_CODE,
} from "./extractArchive.js";

const defaults = {
  maxFiles: 3,
  maxFileBytes: 100,
  maxTotalBytes: 200,
  maxCompressedBytes: 1000,
  maxDepth: 3,
  timeoutMs: 1000,
};

test("detectArchiveFormat identifica RAR4, RAR5 e 7z sem confiar no nome do upload", () => {
  assert.equal(detectArchiveFormat(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])), "rar");
  assert.equal(detectArchiveFormat(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])), "rar");
  assert.equal(detectArchiveFormat(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])), "7z");
});

test("detectArchiveFormat exige formato explícito para TAR sem assinatura", () => {
  const tarV7 = Buffer.alloc(512);
  assert.throws(() => detectArchiveFormat(tarV7), /format=tar/);
  assert.equal(detectArchiveFormat(tarV7, "tar"), "tar");
});

test("detectArchiveFormat impede declaração que não coincide com o conteúdo", () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  assert.throws(() => detectArchiveFormat(zip, "rar"), /não corresponde/);
});

test("normalizeEntryPath recusa traversal, caminhos Windows e caminhos ambíguos", () => {
  assert.equal(normalizeEntryPath("src/index.js", defaults), "src/index.js");
  for (const entry of ["../segredo", "src/../../segredo", "/etc/passwd", "C:/segredo", "src\\segredo", "-comeca-com-hifen"]) {
    assert.throws(() => normalizeEntryPath(entry, defaults), /recusad|escapar|ambíguo/);
  }
  assert.throws(() => normalizeEntryPath("a/b/c/d.txt", defaults), /profundidade/);
});

test("runArchiveExtract preserva o caminho ZIP dedicado quando o magic é ZIP", async () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const expected = { success: true, arquivos: [], totalArquivos: 0, duration: 1, errors: [] };
  let receivedOptions;
  const result = await runArchiveExtract(zip, defaults, {
    runZipExtract: async (_buffer, options) => {
      receivedOptions = options;
      return expected;
    },
  });

  assert.equal(result, expected);
  assert.deepEqual(receivedOptions, defaults);
});

test("runArchiveExtract devolve falha estruturada para body vazio", async () => {
  const result = await runArchiveExtract(Buffer.alloc(0), defaults);
  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /vazio ou inválido/);
});

// ── bsdtar REAL, sem nenhum mock -- o wrapper de ulimit (memória/CPU
// a nível de container, ver comentário em extractArchive.js) só é
// exercitado de verdade se um TAR de verdade passar pelo `bsdtar` de
// verdade, dentro do `/bin/sh -c` de verdade. Nenhum teste anterior
// deste arquivo chegava a rodar `extractWithLibarchive` -- só
// detecção de formato e o desvio pro caminho ZIP.

function criarTarBuffer(nomeArquivo, conteudo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-archive-test-"));
  try {
    fs.writeFileSync(path.join(dir, nomeArquivo), conteudo);
    const tarPath = path.join(dir, "saida.tar");
    execFileSync("tar", ["-cf", tarPath, "-C", dir, nomeArquivo]);
    return fs.readFileSync(tarPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function criarTarBufferMultiplo(entradas) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extract-archive-test-multi-"));
  try {
    const nomes = Object.keys(entradas);
    for (const nome of nomes) {
      const alvo = path.join(dir, nome);
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(alvo, entradas[nome]);
    }
    const tarPath = path.join(dir, "saida.tar");
    execFileSync("tar", ["-cf", tarPath, "-C", dir, ...nomes]);
    return fs.readFileSync(tarPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("runArchiveExtract (TAR real via bsdtar): extração legítima funciona com o wrapper de ulimit aplicado", async () => {
  const tarBuffer = criarTarBuffer("a.txt", "conteudo real, passou pelo bsdtar de verdade");

  const result = await runArchiveExtract(tarBuffer, { format: "tar" });

  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(result.totalArquivos, 1);
  assert.equal(result.arquivos[0].caminho, "a.txt");
  assert.equal(result.arquivos[0].conteudo, "conteudo real, passou pelo bsdtar de verdade");
});

test("runArchiveExtract (TAR real via bsdtar): teto de memória do bsdtar rejeita de forma limpa, sem derrubar o processo", async () => {
  const tarBuffer = criarTarBuffer("a.txt", "conteudo");

  const envAntes = process.env.SANDBOX_BSDTAR_MEMORY_LIMIT_KB;
  // Baixo o bastante pra impedir até o carregador dinâmico do bsdtar
  // de mapear libc -- provado manualmente que isso falha de forma
  // limpa (exit 127), nunca um crash do processo pai (ver comentário
  // em extractArchive.js).
  process.env.SANDBOX_BSDTAR_MEMORY_LIMIT_KB = "2000";
  try {
    const result = await runArchiveExtract(tarBuffer, { format: "tar" });

    assert.equal(result.success, false);
    assert.equal(result.arquivos.length, 0);
    assert.ok(result.errors[0].message.length > 0);
  } finally {
    if (envAntes === undefined) delete process.env.SANDBOX_BSDTAR_MEMORY_LIMIT_KB;
    else process.env.SANDBOX_BSDTAR_MEMORY_LIMIT_KB = envAntes;
  }
});

test("runArchiveExtract (TAR real via bsdtar): com o teto de memória default, a mesma extração legítima continua funcionando", async () => {
  // Confirma que DEFAULT_BSDTAR_MEMORY_LIMIT_KB (512MB) é generoso o
  // bastante pra uma extração real e pequena não ser afetada --
  // sem este teste, um valor default acidentalmente baixo demais só
  // seria descoberto em produção.
  const tarBuffer = criarTarBuffer("b.txt", "x".repeat(50_000));

  const result = await runArchiveExtract(tarBuffer, { format: "tar", maxFileBytes: 100_000, maxTotalBytes: 100_000 });

  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(result.arquivos[0].conteudo.length, 50_000);
});

test("runArchiveExtract (TAR real via bsdtar): entrada com extensão perigosa (.vbs) é rejeitada -- pacote inteiro recusado", async () => {
  const tarBuffer = criarTarBufferMultiplo({
    "app.js": "console.log(1)",
    "script.vbs": "malicious",
  });

  const result = await runArchiveExtract(tarBuffer, { format: "tar" });

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /extensão perigosa/);
  assert.equal(result.arquivos.length, 0);
});

test("runArchiveExtract (TAR real via bsdtar): arquivo .env é rejeitado", async () => {
  const tarBuffer = criarTarBuffer(".env", "SECRET=123");

  const result = await runArchiveExtract(tarBuffer, { format: "tar" });

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /extensão perigosa/);
});

// ── ULIMIT_WRAPPER_SCRIPT em isolamento -- achado real de uma revisão
// pós-implementação: a versão original usava `;` entre os `ulimit` e
// o `exec`, com stderr descartado -- se o `ulimit` falhasse por
// QUALQUER motivo (não só um valor inválido; ex: o kernel/sandbox do
// ambiente de produção recusando a chamada por outro motivo), o
// bsdtar rodava SEM NENHUM limite aplicado, silenciosamente. Testado
// aqui diretamente contra o shell de verdade (não através de
// runArchiveExtract, cuja própria validação de opções já filtra
// valores obviamente inválidos antes de chegar no shell -- este teste
// prova a defesa em profundidade que protege mesmo que ISSO falhe ou
// o SO rejeite um valor por outro motivo).

test("ULIMIT_WRAPPER_SCRIPT: ulimit inválido aborta com ULIMIT_FAILURE_EXIT_CODE, NUNCA chega a rodar o comando", () => {
  const result = spawnSync(SHELL_PATH, [
    "-c",
    ULIMIT_WRAPPER_SCRIPT,
    "wrapper",
    "nao-e-um-numero",
    "30",
    "/bin/sh",
    "-c",
    "echo NAO-DEVERIA-RODAR",
  ]);

  assert.equal(result.status, ULIMIT_FAILURE_EXIT_CODE);
  assert.doesNotMatch(result.stdout.toString("utf8"), /NAO-DEVERIA-RODAR/);
  assert.match(result.stderr.toString("utf8"), /falha ao aplicar ulimit/);
});

test("ULIMIT_WRAPPER_SCRIPT: com valores válidos, aplica os limites e roda o comando normalmente", () => {
  const result = spawnSync(SHELL_PATH, [
    "-c",
    ULIMIT_WRAPPER_SCRIPT,
    "wrapper",
    "524288",
    "30",
    "/bin/sh",
    "-c",
    "echo RODOU-OK",
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout.toString("utf8"), /RODOU-OK/);
});
