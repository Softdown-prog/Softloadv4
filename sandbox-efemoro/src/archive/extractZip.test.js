import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import archiver from "archiver";
import {
  runArchiveExtract,
  checkDiskSpace,
  runZipExtractInWorker,
  toWorkerZipBufferTransfer,
} from "./extractZip.js";

// Roteiro PORTADO de src/solaris/tools/fileTools.test.js (mesmo
// algoritmo de extração, agora aqui) -- extração legítima, zip-slip,
// arquivo grande, zip bomb, excesso de arquivos, buffer corrompido/
// vazio -- MAIS os casos novos que fileTools.js não tinha: tamanho
// compactado, profundidade, symlink, timeout, espaço em disco,
// limpeza garantida em falha.

function criarZipBuffer(entradas) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("data", (c) => chunks.push(c));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    for (const entrada of entradas) {
      if (entrada.type === "symlink") {
        archive.symlink(entrada.name, entrada.target);
      } else {
        archive.append(entrada.content, { name: entrada.name });
      }
    }
    archive.finalize();
  });
}

function tmpArchiveExtractDirs() {
  return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("archive-extract-"));
}

test("runArchiveExtract: extração legítima, conteúdo preservado", async () => {
  const zipBuffer = await criarZipBuffer([
    { name: "app.py", content: "from flask import Flask\napp = Flask(__name__)" },
    { name: "templates/index.html", content: "<h1>Oi</h1>" },
  ]);

  const result = await runArchiveExtract(zipBuffer);

  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(result.totalArquivos, 2);
  const appPy = result.arquivos.find((a) => a.caminho === "app.py");
  assert.ok(appPy.conteudo.includes("Flask(__name__)"));
  assert.equal(appPy.binario, false);
  const index = result.arquivos.find((a) => a.caminho === "templates/index.html");
  assert.ok(index, "templates/index.html não veio na lista");
});

test("runArchiveExtract: zip-slip (\"../\" no meio do caminho) rejeita o zip inteiro", async () => {
  const zipBuffer = await criarZipBuffer([
    { name: "ok.txt", content: "arquivo legítimo" },
    { name: "a/../../evil.txt", content: "tentativa de escapar do diretório" },
  ]);

  const result = await runArchiveExtract(zipBuffer);

  assert.equal(result.success, false);
  assert.equal(result.arquivos.length, 0);
  assert.ok(result.errors[0].message.length > 0);
});

test("runArchiveExtract: arquivo individual maior que o limite é recusado", async () => {
  const zipBuffer = await criarZipBuffer([{ name: "grande.txt", content: "x".repeat(1000) }]);

  const result = await runArchiveExtract(zipBuffer, { maxFileBytes: 500 });

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /excede/);
});

test("runArchiveExtract: total descomprimido acima do limite é recusado (zip bomb)", async () => {
  const zipBuffer = await criarZipBuffer([
    { name: "a.txt", content: "x".repeat(300) },
    { name: "b.txt", content: "x".repeat(300) },
    { name: "c.txt", content: "x".repeat(300) },
  ]);

  const result = await runArchiveExtract(zipBuffer, { maxFileBytes: 500, maxTotalBytes: 700 });

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /zip bomb/);
});

test("runArchiveExtract: mais arquivos que o limite é recusado", async () => {
  const entradas = [];
  for (let i = 0; i < 5; i++) entradas.push({ name: `arquivo${i}.txt`, content: "x" });
  const zipBuffer = await criarZipBuffer(entradas);

  const result = await runArchiveExtract(zipBuffer, { maxFiles: 3 });

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /mais de 3 arquivos/);
});

test("runArchiveExtract: buffer corrompido/não-ZIP rejeita com erro claro", async () => {
  const result = await runArchiveExtract(Buffer.from("isso não é um zip"));

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /zip inválido ou corrompido/);
});

test("runArchiveExtract: buffer vazio/null rejeita sem lançar", async () => {
  const r1 = await runArchiveExtract(Buffer.alloc(0));
  assert.equal(r1.success, false);

  const r2 = await runArchiveExtract(null);
  assert.equal(r2.success, false);
});

test("runArchiveExtract: zip compactado maior que maxCompressedBytes é recusado ANTES de abrir o zip", async () => {
  const zipBuffer = await criarZipBuffer([{ name: "a.txt", content: "conteúdo pequeno" }]);

  const result = await runArchiveExtract(zipBuffer, { maxCompressedBytes: 10 });

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /compactado.*excede/);
});

test("runArchiveExtract: entrada marcada como symlink é rejeitada -- zip inteiro recusado", async () => {
  const zipBuffer = await criarZipBuffer([
    { name: "ok.txt", content: "arquivo legítimo" },
    { type: "symlink", name: "evil-link", target: "../../../etc/passwd" },
  ]);

  const result = await runArchiveExtract(zipBuffer);

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /symlink/);
  assert.equal(result.arquivos.length, 0);
});

test("runArchiveExtract: entrada com extensão perigosa (.exe) é rejeitada -- zip inteiro recusado", async () => {
  const zipBuffer = await criarZipBuffer([
    { name: "ok.txt", content: "arquivo legítimo" },
    { name: "sub/malware.exe", content: "MZ..." },
  ]);

  const result = await runArchiveExtract(zipBuffer);

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /extensão perigosa/);
  assert.equal(result.arquivos.length, 0);
});

test("runArchiveExtract: arquivo .env é rejeitado -- zip inteiro recusado", async () => {
  const zipBuffer = await criarZipBuffer([{ name: ".env", content: "SECRET=123" }]);

  const result = await runArchiveExtract(zipBuffer);

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /extensão perigosa/);
});

test("runArchiveExtract: .env.example (variante de template, sem segredo real) NÃO é rejeitado", async () => {
  const zipBuffer = await criarZipBuffer([{ name: ".env.example", content: "SECRET=preencha-aqui" }]);

  const result = await runArchiveExtract(zipBuffer);

  assert.equal(result.success, true, JSON.stringify(result.errors));
});

test("runArchiveExtract: profundidade de caminho acima do limite é recusada", async () => {
  const caminhoFundo = Array.from({ length: 20 }, (_, i) => `nivel${i}`).join("/") + "/arquivo.txt";
  const zipBuffer = await criarZipBuffer([{ name: caminhoFundo, content: "x" }]);

  const result = await runArchiveExtract(zipBuffer, { maxDepth: 5 });

  assert.equal(result.success, false);
  assert.match(result.errors[0].message, /profundidade máxima/);
});

test("runArchiveExtract: limpeza garantida -- nenhum diretório temporário sobrevive a uma extração rejeitada", async () => {
  const antes = tmpArchiveExtractDirs().length;

  const zipBuffer = await criarZipBuffer([
    { name: "a/../../evil.txt", content: "tentativa de escapar" },
  ]);
  const result = await runArchiveExtract(zipBuffer);
  assert.equal(result.success, false);

  const depois = tmpArchiveExtractDirs().length;
  assert.equal(depois, antes, "diretório temporário de uma extração rejeitada não foi limpo");
});

test("runArchiveExtract: limpeza garantida -- nenhum diretório temporário sobrevive a uma extração bem-sucedida", async () => {
  const antes = tmpArchiveExtractDirs().length;

  const zipBuffer = await criarZipBuffer([{ name: "a.txt", content: "ok" }]);
  const result = await runArchiveExtract(zipBuffer);
  assert.equal(result.success, true);

  const depois = tmpArchiveExtractDirs().length;
  assert.equal(depois, antes, "diretório temporário de uma extração bem-sucedida não foi limpo");
});

test("runArchiveExtract: arquivo binário (byte nulo) vem marcado sem conteúdo, texto normal continua íntegro", async () => {
  const binario = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02]);
  const zipBuffer = await criarZipBuffer([
    { name: "dados.bin", content: binario },
    { name: "texto.txt", content: "conteúdo normal" },
  ]);

  const result = await runArchiveExtract(zipBuffer);

  assert.equal(result.success, true, JSON.stringify(result.errors));

  const dados = result.arquivos.find((a) => a.caminho === "dados.bin");
  assert.equal(dados.binario, true);
  assert.equal(dados.conteudo, null);

  const texto = result.arquivos.find((a) => a.caminho === "texto.txt");
  assert.equal(texto.binario, false);
  assert.equal(texto.conteudo, "conteúdo normal");
});

// ── worker_threads: teto de memória/CPU do processo de extração ────
// (nível de container, ver comentário em extractZip.js). Nenhum mock
// aqui -- worker de verdade, resourceLimits de verdade, mesma versão
// de Node que roda em produção.

// Demora ~30-45s de propósito (não é travamento) -- V8 faz várias
// rodadas de GC "de última instância" antes de desistir e declarar
// OOM; é assim que o mecanismo REALMENTE se comporta nesta versão de
// Node, então é isso que o teste precisa esperar pra provar algo de
// verdade, não uma simulação mais rápida e menos fiel.
test("resourceLimits.maxOldGenerationSizeMb REALMENTE mata uma worker que estoura o heap (prova do mecanismo, não só da lógica de negócio)", async () => {
  const resultado = await new Promise((resolve) => {
    const worker = new Worker(
      `
      const arr = [];
      while (true) {
        arr.push(new Array(1_000_000).fill("x"));
      }
      `,
      { eval: true, resourceLimits: { maxOldGenerationSizeMb: 16 } },
    );
    worker.once("error", (err) => resolve({ tipo: "error", message: err.message }));
    worker.once("exit", (code) => resolve({ tipo: "exit", code }));
  });

  assert.equal(resultado.tipo, "error");
  assert.match(resultado.message, /heap out of memory|memory limit/i);
});

test("runZipExtractInWorker: timeout cancela a worker de verdade (worker.terminate(), não só para de esperar)", async () => {
  const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "archive-extract-worker-timeout-"));
  try {
    const zipBuffer = await criarZipBuffer([{ name: "a.txt", content: "conteudo" }]);
    const opts = { maxFiles: 300, maxFileBytes: 5_000_000, maxTotalBytes: 30_000_000, maxDepth: 12 };

    // 1ms é tempo insuficiente até pra uma worker_thread terminar de
    // subir -- garante que o timeout dispara ANTES de qualquer
    // resposta legítima, exercitando de verdade o caminho de
    // worker.terminate() (não o caminho feliz de "message").
    await assert.rejects(
      () => runZipExtractInWorker(baseDir, zipBuffer, opts, 1),
      /excedeu o tempo limite de 1ms/,
    );
  } finally {
    await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  }
});

// Achado real, testando a ideia óbvia de "configura um teto minúsculo
// e confirma que uma extração real falha limpo": um Buffer de uns
// poucos KB (o `zipBuffer`/conteúdo extraído de um zip pequeno) NÃO
// aciona `maxOldGenerationSizeMb`, mesmo com o teto configurado bem
// abaixo do tamanho do conteúdo -- confirmado tentando várias
// combinações. Motivo: Buffer/ArrayBuffer em Node.js são alocados
// FORA do heap gerenciado do V8 (memória "externa", via malloc), e
// `resourceLimits.maxOldGenerationSizeMb` só conta objetos JS de
// verdade (arrays, strings, objetos) alocados DENTRO do heap do V8 --
// não a memória externa que sustenta um Buffer. O teste acima
// ("REALMENTE mata uma worker...") prova isso: só aciona o limite
// alocando ARRAYS/STRINGS repetidamente, nunca Buffer.alloc().
//
// Isso significa que `maxOldGenerationSizeMb` NÃO é uma defesa
// completa contra um zip que produz muito conteúdo binário/texto
// (que vira Buffer durante o streaming) -- quem já cobre isso, sem
// mudança nesta rodada, é a contagem de bytes em tempo real dentro de
// `extractEntry()` (aborta no instante em que `bytesRead` ultrapassa
// `maxFileBytes`, ANTES de qualquer buffer crescer além do limite
// configurado pelo chamador). O real ganho da worker_thread aqui é
// ISOLAMENTO DE FALHA: qualquer crash (OOM de heap JS, exceção não
// tratada, bug do yauzl) mata só aquela worker, nunca o processo
// Express compartilhado -- não depende de `maxOldGenerationSizeMb`
// especificamente para essa parte da garantia.
test("runArchiveExtract (ZIP real via worker): extração legítima continua funcionando com o teto de memória default (512MB) aplicado", async () => {
  const zipBuffer = await criarZipBuffer([{ name: "a.txt", content: "x".repeat(1_000_000) }]);

  const result = await runArchiveExtract(zipBuffer, { maxFileBytes: 2_000_000, maxTotalBytes: 2_000_000 });

  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(result.arquivos[0].conteudo.length, 1_000_000);
});

// ── toWorkerZipBufferTransfer -- achado real de uma revisão pós-
// implementação: `workerData` clonava o zipBuffer inteiro (até
// 100MB) de forma síncrona antes desta correção, bloqueando o event
// loop principal e dobrando o pico de memória. Os dois testes abaixo
// prova diretamente que a decisão "transferir sem cópia vs. cair pro
// clone seguro" acontece do jeito certo nos dois casos reais.

test("toWorkerZipBufferTransfer: buffer GRANDE e dedicado (não é fatia do pool) é transferido sem cópia", async () => {
  // Conteúdo aleatório e grande o bastante pra Buffer.concat() alocar
  // um ArrayBuffer dedicado (acima do teto de pooling do Node,
  // Buffer.poolSize/2 = 4096 bytes por padrão) -- mesma técnica usada
  // pra provar isso manualmente durante a implementação.
  const zipBuffer = await criarZipBuffer([
    { name: "grande.bin", content: crypto.randomBytes(500_000) },
  ]);
  assert.equal(zipBuffer.byteOffset, 0);
  assert.equal(zipBuffer.byteLength, zipBuffer.buffer.byteLength);

  const { zipBufferForWorker, transferList } = toWorkerZipBufferTransfer(zipBuffer);

  assert.equal(zipBufferForWorker, zipBuffer.buffer);
  assert.deepEqual(transferList, [zipBuffer.buffer]);
});

test("toWorkerZipBufferTransfer: buffer PEQUENO (pode ser fatia do pool interno do Node) cai pro clone seguro, nunca é transferido", () => {
  // Buffer.allocUnsafe() (usado por Buffer.concat internamente) só
  // evita o pool acima de Buffer.poolSize/2 -- um buffer pequeno o
  // bastante É, na prática, uma fatia compartilhada; transferir o
  // ArrayBuffer inteiro nesse caso destacaria memória de outras
  // alocações não relacionadas.
  const pequeno = Buffer.from("conteudo pequeno o bastante pra cair no pool");
  // Confirma a premissa do teste antes de testar o comportamento:
  // este buffer realmente NÃO ocupa o ArrayBuffer inteiro sozinho.
  assert.ok(pequeno.byteLength < pequeno.buffer.byteLength || pequeno.byteOffset !== 0);

  const { zipBufferForWorker, transferList } = toWorkerZipBufferTransfer(pequeno);

  assert.equal(zipBufferForWorker, pequeno);
  assert.deepEqual(transferList, []);
});

test("runArchiveExtract (ZIP real via worker): buffer grande transferido sem cópia -- extração continua correta e o buffer original fica detachado", async () => {
  const conteudoOriginal = crypto.randomBytes(500_000);
  const zipBuffer = await criarZipBuffer([{ name: "grande.bin", content: conteudoOriginal }]);
  assert.equal(zipBuffer.byteOffset, 0, "pré-condição do teste: precisa ser um buffer dedicado, senão não prova a transferência");

  const result = await runArchiveExtract(zipBuffer, { maxFileBytes: 600_000, maxTotalBytes: 600_000 });

  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(result.arquivos[0].binario, true);
  // Prova que a transferência aconteceu de verdade (zero cópia): o
  // ArrayBuffer original foi DETACHADO pelo worker_threads --
  // byteLength cai pra 0 depois que o conteúdo "mudou de dono".
  assert.equal(zipBuffer.buffer.byteLength, 0);
});

test("checkDiskSpace: rejeita quando o espaço necessário excede absurdamente o disponível", async () => {
  await assert.rejects(
    () => checkDiskSpace(os.tmpdir(), Number.MAX_SAFE_INTEGER),
    /espaço em disco insuficiente/,
  );
});

test("checkDiskSpace: não rejeita quando o espaço necessário é trivial", async () => {
  await checkDiskSpace(os.tmpdir(), 1);
});

