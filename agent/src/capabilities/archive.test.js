import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Permissions } from "../security/permissions.js";
import { Workspace } from "../core/workspace.js";
import { ArchiveCapability } from "./archive.js";

let envSnapshot;
let workspaceRoot;
let workspace;

beforeEach(async () => {
  envSnapshot = { ...process.env };
  process.env.SANDBOX_SERVICE_URL = "https://sandbox.exemplo.internal";
  process.env.SANDBOX_SHARED_SECRET = "segredo-teste";

  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "archive-capability-test-"));
  workspace = new Workspace({ root: workspaceRoot });
  await workspace.initialize();
});

afterEach(async () => {
  process.env = envSnapshot;
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

function respostaJson(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}

function makeCapability(fetchImpl, permissionsOverride) {
  const permissions = new Permissions({
    mode: "full",
    ...(permissionsOverride || {}),
  });
  return new ArchiveCapability({ workspace, permissions, fetchImpl });
}

test("archive.extract_zip exige zipPath", async () => {
  const capability = makeCapability(async () => respostaJson(200, {}));

  await assert.rejects(
    () => capability.execute({ type: "archive.extract_zip", destPath: "extraido" }),
    /exige zipPath/,
  );
});

test("archive.extract_zip exige destPath", async () => {
  await workspace.write("upload.zip", "conteúdo qualquer");
  const capability = makeCapability(async () => respostaJson(200, {}));

  await assert.rejects(
    () => capability.execute({ type: "archive.extract_zip", zipPath: "upload.zip" }),
    /exige destPath/,
  );
});

test("archive.extract_zip lança erro claro quando SANDBOX_SERVICE_URL não está configurada", async () => {
  delete process.env.SANDBOX_SERVICE_URL;
  await workspace.write("upload.zip", "conteúdo qualquer");
  const capability = makeCapability(async () => respostaJson(200, {}));

  await assert.rejects(
    () => capability.execute({ type: "archive.extract_zip", zipPath: "upload.zip", destPath: "extraido" }),
    /SANDBOX_SERVICE_URL não configurada/,
  );
});

test("archive.extract_zip lê o zip do workspace como Buffer e manda no corpo pro /extract-zip", async () => {
  const bytesZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef]);
  await fs.writeFile(path.join(workspaceRoot, "upload.zip"), bytesZip);

  const chamadas = [];
  const capability = makeCapability(async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return respostaJson(200, { success: true, totalArquivos: 0, arquivos: [] });
  });

  await capability.execute({ type: "archive.extract_zip", zipPath: "upload.zip", destPath: "extraido" });

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "https://sandbox.exemplo.internal/extract-zip");
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.equal(chamadas[0].opcoes.headers["x-sandbox-secret"], "segredo-teste");
  assert.equal(chamadas[0].opcoes.headers["Content-Type"], "application/octet-stream");
  assert.ok(Buffer.isBuffer(chamadas[0].opcoes.body));
  assert.ok(chamadas[0].opcoes.body.equals(bytesZip), "o corpo enviado não bate com os bytes do zip no workspace");
});

test("archive.extract_zip repassa limites como query string, só os definidos", async () => {
  await workspace.write("upload.zip", "z");
  let urlChamada;
  const capability = makeCapability(async (url) => {
    urlChamada = url;
    return respostaJson(200, { success: true, totalArquivos: 0, arquivos: [] });
  });

  await capability.execute({
    type: "archive.extract_zip",
    zipPath: "upload.zip",
    destPath: "extraido",
    maxFiles: 50,
    timeoutMs: 5000,
  });

  const url = new URL(urlChamada);
  assert.equal(url.searchParams.get("maxFiles"), "50");
  assert.equal(url.searchParams.get("timeoutMs"), "5000");
  assert.equal(url.searchParams.has("maxFileBytes"), false);
});

test("archive.extract_zip grava só os arquivos de texto no workspace, lista binários em ignorados", async () => {
  await workspace.write("upload.zip", "z");
  const capability = makeCapability(async () =>
    respostaJson(200, {
      success: true,
      totalArquivos: 2,
      arquivos: [
        { caminho: "app.py", conteudo: "print('oi')", binario: false },
        { caminho: "logo.png", conteudo: null, binario: true },
      ],
    }),
  );

  const result = await capability.execute({
    type: "archive.extract_zip",
    zipPath: "upload.zip",
    destPath: "extraido",
  });

  assert.deepEqual(result.arquivos, ["extraido/app.py"]);
  assert.deepEqual(result.ignorados, ["logo.png"]);

  const conteudoGravado = await workspace.read("extraido/app.py");
  assert.equal(conteudoGravado, "print('oi')");

  assert.equal(await workspace.exists("extraido/logo.png"), false);
});

test("archive.extract_zip propaga como exceção uma falha de INFRAESTRUTURA (HTTP não-ok)", async () => {
  await workspace.write("upload.zip", "z");
  const capability = makeCapability(async () => respostaJson(401, { error: "não autenticado" }));

  await assert.rejects(
    () => capability.execute({ type: "archive.extract_zip", zipPath: "upload.zip", destPath: "extraido" }),
    /401.*não autenticado/,
  );
});

test("archive.extract_zip lança quando a extração foi RECUSADA (HTTP 200, success:false)", async () => {
  await workspace.write("upload.zip", "z");
  const capability = makeCapability(async () =>
    respostaJson(200, { success: false, errors: [{ message: "zip-slip detectado" }] }),
  );

  await assert.rejects(
    () => capability.execute({ type: "archive.extract_zip", zipPath: "upload.zip", destPath: "extraido" }),
    /zip-slip detectado/,
  );

  // Nada deveria ter sido gravado no workspace numa extração recusada.
  assert.equal(await workspace.exists("extraido"), false);
});

test("archive.extract_zip funciona sem SANDBOX_SHARED_SECRET (não manda o header)", async () => {
  delete process.env.SANDBOX_SHARED_SECRET;
  await workspace.write("upload.zip", "z");
  let headersRecebidos;
  const capability = makeCapability(async (url, opcoes) => {
    headersRecebidos = opcoes.headers;
    return respostaJson(200, { success: true, totalArquivos: 0, arquivos: [] });
  });

  await capability.execute({ type: "archive.extract_zip", zipPath: "upload.zip", destPath: "extraido" });
  assert.equal(headersRecebidos["x-sandbox-secret"], undefined);
});

test("archive.extract_zip respeita Permissions -- negado por padrão (preset restricted)", async () => {
  await workspace.write("upload.zip", "z");
  const capability = makeCapability(
    async () => respostaJson(200, { success: true, totalArquivos: 0, arquivos: [] }),
    { mode: "restricted" },
  );

  await assert.rejects(
    () => capability.execute({ type: "archive.extract_zip", zipPath: "upload.zip", destPath: "extraido" }),
    /Permissão negada/,
  );
});

test("archive.extract_zip: zipPath fora do workspace (path traversal) é recusado antes de qualquer chamada de rede", async () => {
  let chamouRede = false;
  const capability = makeCapability(async () => {
    chamouRede = true;
    return respostaJson(200, { success: true, totalArquivos: 0, arquivos: [] });
  });

  await assert.rejects(
    () => capability.execute({ type: "archive.extract_zip", zipPath: "../fora-do-workspace.zip", destPath: "extraido" }),
    /fora do workspace/,
  );
  assert.equal(chamouRede, false, "não deveria ter chamado o serviço isolado com um caminho fora do workspace");
});
