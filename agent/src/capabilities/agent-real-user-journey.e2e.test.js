// Simulacao do uso de ferramentas do Solaris SEM API paga e SEM VPS.
// Exercita o Worker real via HTTP, workspace temporario e Node real.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Agent } from "../agent.js";
import { createApp } from "../server.js";
import { Permissions } from "../security/permissions.js";
import { CommandPolicy } from "../security/command-policy.js";

const SECRET = "simulacao-agent-local-sem-segredos";

test("smoke real: HTTP -> criar projeto -> detectar erro -> corrigir -> compilar/testar -> relatorio", async () => {
  const before = process.env.WORKER_SHARED_SECRET;
  process.env.WORKER_SHARED_SECRET = SECRET;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "solaris-real-smoke-"));
  const agent = new Agent({
    workspaceRoot: dir,
    permissions: new Permissions({
      mode: "restricted",
      permissions: { "build.run": true, "test.run": true },
    }),
    commandPolicy: new CommandPolicy({
      allowedCommands: ["node"],
      allowedPrefixes: ["node --check", "node --test"],
    }),
  });
  let server;
  const steps = [];
  try {
    await agent.start();
    server = createApp(agent).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    let n = 0;
    const send = async (capability, operation, input = {}, auth = true) => {
      const headers = { "Content-Type": "application/json" };
      if (auth) headers["x-worker-secret"] = SECRET;
      const response = await fetch(base + "/run", {
        method: "POST",
        headers,
        body: JSON.stringify({
          request_id: "smoke-" + (++n),
          task: "execute",
          actions: [{ id: "action-" + n, capability, operation, input }],
        }),
      });
      const body = await response.json();
      return { status: response.status, action: body.results?.[0], body };
    };
    // A rota interna deve exigir segredo mesmo que a maquina seja local.
    assert.equal((await send("filesystem", "list", {}, false)).status, 401);
    steps.push("autenticacao: bloqueou requisicao sem segredo");

    const check = await fetch(base + "/health");
    assert.equal(check.status, 200);
    const capabilities = await (await fetch(base + "/capabilities")).json();
    assert.ok(capabilities.filesystem.includes("edit"));
    assert.ok(capabilities.build.includes("run"));
    assert.ok(capabilities.test.includes("run"));

    const broken = "export function somar(a, b) { return a + ; }\n";
    const correct = "export function somar(a, b) { return a + b; }\n";
    const unitTest = [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { somar } from './calc.mjs';",
      "test('somar dois numeros', () => assert.equal(somar(2, 3), 5));",
      "",
    ].join("\n");
    const pkg = JSON.stringify({
      private: true,
      type: "module",
      scripts: {
        build: "node --check calc.mjs",
        test: "node --test calc.test.mjs",
      },
    });

    for (const [file, content] of [["package.json", pkg], ["calc.mjs", broken], ["calc.test.mjs", unitTest]]) {
      const result = await send("filesystem", "write", { path: file, content });
      assert.equal(result.status, 200);
      assert.equal(result.action?.ok, true, "Falha ao criar " + file + ": " + JSON.stringify(result.action));
    }
    steps.push("criar: pacote, codigo JS com erro intencional e teste unitario gravados");

    const inspected = await send("project-inspector", "inspect");
    assert.equal(inspected.action?.ok, true);
    assert.equal(inspected.action?.result?.tests?.detected, true);
    assert.equal(inspected.action?.result?.build?.detected, true);
    steps.push("inspecao: identificou scripts de build e teste do projeto");

    const buildDetected = await send("build", "detect");
    assert.equal(buildDetected.action?.ok, true);
    assert.equal(buildDetected.action?.result?.detected, true);
    const testsDetected = await send("test", "detect");
    assert.equal(testsDetected.action?.ok, true);
    assert.equal(testsDetected.action?.result?.detected, true);

    const failedSyntax = await send("build", "run", { command: "node --check calc.mjs", timeout_ms: 30000 });
    assert.equal(failedSyntax.action?.ok, true);
    assert.notEqual(failedSyntax.action?.result?.exitCode, 0, "Erro de sintaxe passou sem ser detectado");
    steps.push("sintaxe: rejeitou codigo com erro real usando node --check");

    const failedTest = await send("test", "run", { command: "node --test calc.test.mjs", timeout_ms: 30000 });
    assert.equal(failedTest.action?.ok, true);
    assert.notEqual(failedTest.action?.result?.exitCode, 0);
    steps.push("testes: reprovou projeto quebrado");

    const edit = await send("filesystem", "edit", {
      path: "calc.mjs",
      old_string: "a + ;",
      new_string: "a + b;",
    });
    assert.equal(edit.action?.ok, true);
    assert.equal(edit.action?.result?.edited, true);
    const read = await send("filesystem", "read", { path: "calc.mjs" });
    assert.equal(read.action?.result?.content, correct);
    steps.push("corrigir: substituiu apenas a parte errada e releu o arquivo");

    const validSyntax = await send("build", "run", { command: "node --check calc.mjs", timeout_ms: 30000 });
    assert.equal(validSyntax.action?.ok, true);
    assert.equal(validSyntax.action?.result?.exitCode, 0);
    const validTests = await send("test", "run", { command: "node --test calc.test.mjs", timeout_ms: 30000 });
    assert.equal(validTests.action?.ok, true);
    assert.equal(validTests.action?.result?.exitCode, 0);
    steps.push("revalidar: sintaxe e teste unitario passam de verdade");

    const deniedDelete = await send("filesystem", "delete", { path: "calc.mjs" });
    assert.equal(deniedDelete.action?.ok, false);
    assert.equal(deniedDelete.action?.error?.code, "PERMISSION_DENIED");
    const deniedTraversal = await send("filesystem", "read", { path: "../../fora-da-pasta" });
    assert.equal(deniedTraversal.action?.ok, false);
    assert.equal((await fs.readFile(path.join(dir, "calc.mjs"), "utf8")), correct);
    steps.push("seguranca: exclusao sem permissao e fuga do workspace bloqueadas");

    const catalog = await send("forge", "catalog");
    assert.equal(catalog.action?.ok, true);
    assert.ok(catalog.action?.result?.recipes?.length > 50);
    steps.push("Forge: catalogo real consultado sem IA externa");

    const deniedForge = await send("forge", "render", { id: "nao-gerar", command: "html5-runtime" });
    assert.equal(deniedForge.action?.ok, false);
    assert.equal(deniedForge.action?.error?.code, "PERMISSION_DENIED");
    steps.push("Forge: renderizacao negada ao perfil sem permissao");

    const placeholder = await send("storage", "list", { bucket: "teste", path: "arquivo" });
    assert.equal(placeholder.action?.ok, false);
    steps.push("limite encontrado: storage ainda nao e operacao funcional");

    assert.equal((await fs.readFile(path.join(dir, "calc.mjs"), "utf8")), correct);
    for (const line of steps) console.log("SOLARIS_SMOKE_OK: " + line);
    console.log("SOLARIS_SMOKE_RESUMO: " + JSON.stringify({
      etapa: "criar, detectar, corrigir, testar, relatar",
      etapasPassaram: steps.length,
      geminiApiUsada: false,
      vpsAlterada: false,
      integracaoChatComIAValidada: false,
      observacao: "Testado Worker HTTP real; edicao dirigida pelo roteiro de teste, nao por IA.",
    }));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await agent.stop();
    await fs.rm(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env.WORKER_SHARED_SECRET;
    else process.env.WORKER_SHARED_SECRET = before;
  }
});
