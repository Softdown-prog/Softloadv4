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
];

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
    console.log("[AGENT-TS] OK", relative);
  } catch (error) {
    console.error("[AGENT-TS] DIVERGENCIA:", relative, error.message);
    errors++;
  }
}
if (errors) {
  console.error("[AGENT-TS] Corrija o fonte TypeScript ou regenere seu espelho JS antes de publicar.");
  process.exitCode = 1;
}
