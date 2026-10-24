import { parentPort, workerData } from "node:worker_threads";
import { extractInto } from "./extractZip.js";

// Entry point de uma worker_thread dedicada a UMA extração de ZIP --
// nunca reaproveitada entre requisições (ver runZipExtractInWorker em
// extractZip.js, que cria e termina uma worker por chamada). Roda num
// V8 isolate PRÓPRIO, com `resourceLimits.maxOldGenerationSizeMb`
// aplicado na criação -- se `extractInto` (mesma função, mesma
// lógica de sempre) estourar esse teto de heap, o V8 mata só esta
// thread (o processo principal do Express recebe um evento "error" no
// objeto Worker, nunca é derrubado junto).
async function main() {
  const { baseDir, zipBuffer, opts } = workerData;
  try {
    // `zipBuffer` chega em uma de duas formas, dependendo de como
    // runZipExtractInWorker decidiu enviá-lo (ver
    // toWorkerZipBufferTransfer em extractZip.js): um ArrayBuffer cru
    // (transferido sem cópia -- `Buffer.from` aqui só cria uma VIEW,
    // sem copiar de novo) ou um Buffer/Uint8Array já materializado
    // pelo clone estruturado padrão (`Buffer.from` copia, mas o dado
    // já era pequeno o bastante pra ter caído nesse caminho). Os dois
    // casos precisam do mesmo `Buffer.from(...)` -- não dá pra saber
    // qual chegou sem checar o tipo, e tratar os dois da mesma forma
    // é mais simples do que ramificar.
    const arquivos = await extractInto(baseDir, Buffer.from(zipBuffer), opts);
    parentPort.postMessage({ ok: true, arquivos });
  } catch (err) {
    parentPort.postMessage({ ok: false, message: err.message });
  }
}

main();
