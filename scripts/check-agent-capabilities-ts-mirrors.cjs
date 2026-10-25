"use strict";

/**
 * Garante que os .js usados pelo Worker Agent sao semanticamente iguais
 * aos fontes TypeScript correspondentes. O Agent ainda executa Node 22
 * ESM em producao: nao renomear o runtime para .ts sem etapa de build.
 *
 * A comparacao por AST ignora apenas formatacao/posicoes, nao altera
 * funcoes, parametros, validacoes, URLs nem controle de fluxo.
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");
const acorn = require("acorn");

const root = path.resolve(__dirname, "..");
const emitRuntime = process.argv.includes("--write");
const verifiedOutputs = [];
const sources = [
  "agent/src/capabilities/storage.ts",
  "agent/src/capabilities/artifacts.ts",
  "agent/src/capabilities/knowledge-search.ts",
  "agent/src/capabilities/web-sandbox.ts",
  "agent/src/capabilities/archive.ts",
  "agent/src/capabilities/plan-tracker.ts",
  "agent/src/capabilities/build.ts",
  "agent/src/capabilities/test.ts",
  "agent/src/capabilities/package.ts",
  "agent/src/capabilities/code-analysis.ts",
  "agent/src/capabilities/project-inspector.ts",
  "agent/src/capabilities/asset-forge.ts",
  "agent/src/capabilities/shell.ts",
  "agent/src/capabilities/git.ts",
  "agent/src/capabilities/github.ts",
  "agent/src/capabilities/code-search.ts",
  "agent/src/capabilities/escalation.ts",
  "agent/src/capabilities/agent-parallel-dispatch.ts",
  "agent/src/capabilities/filesystem.ts",
  "agent/src/capabilities/mcp-client.ts",
  "agent/src/capabilities/web-fetch.ts",
  "agent/src/capabilities/process.ts",
  "agent/src/capabilities/web-search.ts",
  "agent/src/utils/logger.ts",
  "agent/src/index.ts",
  "agent/src/core/task-router.ts",
  "agent/src/core/task-runner.ts",
  "agent/src/protocol/protocol-adapter.ts",
  "agent/src/utils/errors.ts",
  "agent/src/server.ts",
  "agent/src/protocol/protocol.ts",
  "agent/src/agent.ts",
  "agent/src/security/permissions.ts",
  "agent/src/security/command-policy.ts",
  "agent/src/security/role-permissions.ts",
  "agent/src/security/ssrf-guard.ts",
  "agent/src/utils/parse-command.ts",
  "agent/src/config/solaris-allowed-domains.ts",
  "agent/src/config/sandbox-endpoints.ts",
  "agent/src/config/mcpServers.ts",
  "agent/src/utils/run-command.ts",
  "agent/src/core/workspace.ts",
  "agent/src/notifications/webhook-delivery.ts",
  "agent/src/orchestration/git-worktree-pool.ts",
  "agent/src/orchestration/coder-validator-loop.ts",
  "agent/src/agent-dispatch-capability.ts",
  "agent/src/utils/diff-patch-engine.ts",
  "agent/src/orchestration/example-usage.ts",
  "agent/src/orchestration/orchestrator-example.ts",
  "agent/scripts/vendorPowerUp.ts",
];

// Prevent migration regressions: every production .js in the Worker
// must have a corresponding .ts in the explicit, reviewable build list.
// Tests and reusable test fixtures are intentionally not production code.
const sourceSet = new Set(sources);
const typeOnlySources = new Set([
  "agent/src/capabilities/capability-types.ts",
]);
let inventoryErrors = 0;
if (sourceSet.size !== sources.length) {
  console.error("[AGENT-TS] Fonte duplicada na lista de módulos TypeScript.");
  inventoryErrors++;
}
function discoverSources(relativeDir) {
  const results = [];
  for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "__testUtils__" || entry.name === "__fixtures__") continue;
      results.push(...discoverSources(path.posix.join(relativeDir, entry.name)));
    } else if (entry.isFile() && /\.(?:js|ts)$/.test(entry.name) &&
      !/\.(?:test|spec)\.(?:js|ts)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")) {
      results.push(path.posix.join(relativeDir, entry.name));
    }
  }
  return results;
}
const discovered = new Set([
  ...discoverSources("agent/src"),
  ...discoverSources("agent/scripts"),
]);
for (const file of discovered) {
  if (file.endsWith(".js")) {
    const typed = file.replace(/\.js$/, ".ts");
    if (!sourceSet.has(typed)) {
      console.error("[AGENT-TS] JavaScript de produção sem fonte TS registrada:", file);
      inventoryErrors++;
    }
  } else if (!sourceSet.has(file) && !typeOnlySources.has(file)) {
    console.error("[AGENT-TS] TypeScript não registrado no build:", file);
    inventoryErrors++;
  }
}
for (const typed of sources) {
  if (!discovered.has(typed) || !discovered.has(typed.replace(/\.ts$/, ".js"))) {
    console.error("[AGENT-TS] Par TS/JS ausente para módulo registrado:", typed);
    inventoryErrors++;
  }
}
if (inventoryErrors) {
  console.error("[AGENT-TS] Corrija o inventário antes de compilar ou publicar.");
  process.exit(1);
}

const ignoredAstKeys = new Set(["start", "end", "loc", "range", "raw"]);

function semanticAst(source, fileName) {
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
  });
  return JSON.parse(JSON.stringify(ast, (key, value) =>
    ignoredAstKeys.has(key) ? undefined : value));
}

let errors = 0;
for (const relative of sources) {
  const pathTs = path.join(root, relative);
  const pathJs = pathTs.replace(/\.ts$/, ".js");
  const transpiled = ts.transpileModule(fs.readFileSync(pathTs, "utf8"), {
    fileName: pathTs,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      // Preserve imports that exist in the runtime JS even when unused.
      // Type-only imports continue to be erased from the generated JS.
      verbatimModuleSyntax: true,
      newLine: ts.NewLineKind.LineFeed,
    },
    reportDiagnostics: true,
  });
  const diagnostics = (transpiled.diagnostics || []).filter(
    d => d.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length) {
    console.error("Falha ao transpilar", relative, diagnostics);
    errors++;
    continue;
  }
  try {
    assert.deepStrictEqual(
      semanticAst(transpiled.outputText, pathTs),
      semanticAst(fs.readFileSync(pathJs, "utf8"), pathJs),
      "O espelho JavaScript divergiu do TypeScript");
    verifiedOutputs.push({ relative, pathJs, compiled: transpiled.outputText });
    console.log("[AGENT-TS] OK", relative);
  } catch (error) {
    console.error("[AGENT-TS] DIVERGENCIA:", relative, error.message);
    errors++;
  }
}
if (errors) {
  console.error("[AGENT-TS] Corrija o fonte TypeScript ou regenere seu espelho JS antes de publicar.");
  process.exitCode = 1;
} else if (emitRuntime) {
  // All listed modules must pass AST parity BEFORE any runtime JS is overwritten.
  // Intended for disposable GitHub Actions checkouts, never production VPS.
  let changed = 0;
  for (const { pathJs, compiled } of verifiedOutputs) {
    if (fs.readFileSync(pathJs, "utf8") === compiled) continue;
    fs.writeFileSync(pathJs, compiled, "utf8");
    changed++;
  }
  console.log(`[AGENT-TS] Compilados ${verifiedOutputs.length} módulos ESM (${changed} espelhos atualizados neste checkout).`);
}
