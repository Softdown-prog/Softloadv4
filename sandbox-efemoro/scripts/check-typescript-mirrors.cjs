"use strict";

// Garante que os arquivos JS executados pelo sandbox acompanham a fonte TS.
// O container de produção continua usando Node 22 + JavaScript, sem tsc em runtime.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../..")] }));
const acorn = require(require.resolve("acorn", { paths: [path.resolve(__dirname, "../..")] }));

const root = path.resolve(__dirname, "..");
const sources = [
  "src/utils/envInt.ts",
  "src/utils/logger.ts",
  "src/serviceMode.ts",
  "src/webSandbox/devices.ts",
  "src/webSandbox/security.ts",
  "src/archive/security.ts",
];
const ignored = new Set(["start", "end", "loc", "range", "raw"]);
function semanticAst(input) {
  const parsed = acorn.parse(input, { ecmaVersion: "latest", sourceType: "module" });
  return JSON.parse(JSON.stringify(parsed, (key, value) =>
    ignored.has(key) ? undefined : value));
}
for (const source of sources) {
  const tsPath = path.join(root, source);
  const jsPath = tsPath.replace(/\.ts$/, ".js");
  const result = ts.transpileModule(fs.readFileSync(tsPath, "utf8"), {
    fileName: tsPath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(
    item => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, source + ": falha ao transpilar");
  assert.deepStrictEqual(
    semanticAst(result.outputText),
    semanticAst(fs.readFileSync(jsPath, "utf8")),
    source + ": o espelho JS divergiu do TS",
  );
  console.log("[SANDBOX-TS] OK", source);
}
