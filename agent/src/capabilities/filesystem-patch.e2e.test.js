import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Workspace } from "../core/workspace.js";
import { Permissions } from "../security/permissions.js";
import { Agent } from "../agent.js";
import { createApp } from "../server.js";
import { FileSystemCapability } from "./filesystem.js";

const execFileAsync = promisify(execFile);

/**
 * Teste de ponta a ponta GENUÍNO das operações file.diff/file.patch:
 * compila Power-up/diff_patch_engine.cpp de verdade (uma vez, nesta
 * suíte) e `DIFF_PATCH_ENGINE_BIN` aponta pro binário resultante --
 * nada aqui é mockado. Cobre tanto a capability isolada quanto o
 * protocolo HTTP completo (POST /run com campos snake_case reais),
 * já que a tradução de campo (new_content -> newContent) e o schema
 * zod (protocol.js) só são exercitados de verdade nesse caminho.
 */
let envSnapshot;

before(async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..");
  const sourcePath = path.join(repoRoot, "Power-up", "diff_patch_engine.cpp");

  const tmpBuildDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "filesystem-patch-e2e-build-"),
  );
  const binPath = path.join(tmpBuildDir, "diff_patch_engine");

  await execFileAsync("g++", ["-std=c++17", "-O2", "-o", binPath, sourcePath]);

  envSnapshot = process.env.DIFF_PATCH_ENGINE_BIN;
  process.env.DIFF_PATCH_ENGINE_BIN = binPath;
});

after(() => {
  process.env.DIFF_PATCH_ENGINE_BIN = envSnapshot;
});

async function makeCapability(permissionsOverride) {
  const base = await fs.mkdtemp(
    path.join(os.tmpdir(), "sl-filesystem-patch-test-"),
  );
  const root = path.join(base, "workspace");
  const workspace = new Workspace({ root });
  await workspace.initialize();

  const permissions = new Permissions({
    mode: "full",
    ...(permissionsOverride || {}),
  });

  const capability = new FileSystemCapability({ workspace, permissions });

  return { base, root, workspace, capability };
}

test("file.diff + file.patch: fluxo completo -- calcula, revisa e aplica, gravando de verdade no disco", async () => {
  const { base, root, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "soma.js",
      content: "function soma(a, b) {\n  return a + b;\n}\n",
    });

    const diffResult = await capability.execute({
      type: "file.diff",
      path: "soma.js",
      newContent: "function soma(a, c) {\n  return a - c;\n}\n",
    });

    assert.equal(diffResult.path, "soma.js");
    assert.equal(diffResult.patch.format, "structural-token-diff-v2");
    assert.ok(diffResult.summary.insertedChars > 0);
    assert.ok(diffResult.summary.deletedChars > 0);

    // O arquivo real no disco não muda com file.diff -- só depois de
    // file.patch, explicitamente.
    const conteudoAntes = await fs.readFile(path.join(root, "soma.js"), "utf8");
    assert.equal(conteudoAntes, "function soma(a, b) {\n  return a + b;\n}\n");

    const patchResult = await capability.execute({
      type: "file.patch",
      path: "soma.js",
      patch: diffResult.patch,
    });

    assert.deepEqual(patchResult, { path: "soma.js", patched: true });

    const conteudoDepois = await fs.readFile(path.join(root, "soma.js"), "utf8");
    assert.equal(conteudoDepois, "function soma(a, c) {\n  return a - c;\n}\n");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.patch: rejeita e NÃO toca o arquivo quando ele mudou desde o file.diff (hash divergente)", async () => {
  const { base, root, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "config.json",
      content: '{"versao": 1}',
    });

    const diffResult = await capability.execute({
      type: "file.diff",
      path: "config.json",
      newContent: '{"versao": 2}',
    });

    // Outro "processo" (ex: outro agent, ou o próprio usuário) altera
    // o arquivo entre o diff e o patch -- cenário real de edição
    // concorrente que a verificação de hash existe pra pegar.
    await capability.execute({
      type: "file.write",
      path: "config.json",
      content: '{"versao": 1, "mudou": true}',
    });

    await assert.rejects(
      () =>
        capability.execute({
          type: "file.patch",
          path: "config.json",
          patch: diffResult.patch,
        }),
      /hash de origem não confere/,
    );

    // Nada foi escrito -- o arquivo continua exatamente como a
    // "edição concorrente" deixou, e nenhum arquivo .tmp-* sobrou.
    const conteudoFinal = await fs.readFile(path.join(root, "config.json"), "utf8");
    assert.equal(conteudoFinal, '{"versao": 1, "mudou": true}');

    const entradas = await fs.readdir(root);
    assert.deepEqual(entradas.sort(), ["config.json"]);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.diff: exige newContent", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({ type: "file.write", path: "a.txt", content: "x" });

    await assert.rejects(
      () => capability.execute({ type: "file.diff", path: "a.txt" }),
      /exige newContent/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.patch: exige patch", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({ type: "file.write", path: "a.txt", content: "x" });

    await assert.rejects(
      () => capability.execute({ type: "file.patch", path: "a.txt" }),
      /exige patch/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("Permissions: file.patch negado impede a operação mesmo com file.diff liberado", async () => {
  // `mode: "full"` (default de makeCapability) faz bypass total,
  // ignorando o mapa `permissions` -- precisa de um mode diferente
  // pra esse mapa valer de verdade (mesmo comportamento documentado
  // em Permissions.can()).
  const { base, capability } = await makeCapability({
    mode: "restricted",
    permissions: { "file.write": true, "file.diff": true, "file.patch": false },
  });

  try {
    await capability.execute({ type: "file.write", path: "a.txt", content: "x" });

    const diffResult = await capability.execute({
      type: "file.diff",
      path: "a.txt",
      newContent: "y",
    });

    await assert.rejects(
      () =>
        capability.execute({
          type: "file.patch",
          path: "a.txt",
          patch: diffResult.patch,
        }),
      /Permiss/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

// ── Protocolo HTTP completo (POST /run) ──────────────────────────

let server;
let baseUrl;
let tempServerBase;

async function startTestServer() {
  tempServerBase = await fs.mkdtemp(
    path.join(os.tmpdir(), "worker-agent-patch-server-test-"),
  );
  const workspaceRoot = path.join(tempServerBase, "workspace");

  const agent = new Agent({ workspaceRoot, permissions: new Permissions({ mode: "full" }) });
  await agent.start();

  const app = createApp(agent);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer() {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempServerBase, { recursive: true, force: true });
}

test("POST /run: filesystem.diff + filesystem.patch ponta a ponta via protocolo HTTP real (snake_case)", async () => {
  await startTestServer();

  try {
    const escreve = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "r1",
        task: "execute",
        actions: [
          {
            id: "w1",
            capability: "filesystem",
            operation: "write",
            input: { path: "nota.txt", content: "versao um" },
          },
        ],
      }),
    });
    assert.equal(escreve.status, 200);

    const diffResp = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "r2",
        task: "execute",
        actions: [
          {
            id: "d1",
            capability: "filesystem",
            operation: "diff",
            input: { path: "nota.txt", new_content: "versao dois" },
          },
        ],
      }),
    });
    assert.equal(diffResp.status, 200);
    const diffBody = await diffResp.json();
    const patch = diffBody.results.find((r) => r.actionId === "d1").result.patch;
    assert.equal(patch.format, "structural-token-diff-v2");

    const patchResp = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: "r3",
        task: "execute",
        actions: [
          {
            id: "p1",
            capability: "filesystem",
            operation: "patch",
            input: { path: "nota.txt", patch },
          },
        ],
      }),
    });
    assert.equal(patchResp.status, 200);
    const patchBody = await patchResp.json();
    assert.equal(patchBody.results.find((r) => r.actionId === "p1").result.patched, true);

    const conteudoFinal = await fs.readFile(
      path.join(tempServerBase, "workspace", "nota.txt"),
      "utf8",
    );
    assert.equal(conteudoFinal, "versao dois");
  } finally {
    await stopTestServer();
  }
});
