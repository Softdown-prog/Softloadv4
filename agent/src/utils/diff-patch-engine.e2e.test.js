import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { computeDiff, applyPatch, DiffPatchEngineError } from "./diff-patch-engine.js";

const execFileAsync = promisify(execFile);

/**
 * Teste de ponta a ponta GENUÍNO: compila Power-up/diff_patch_engine.cpp
 * de verdade (g++, mesmo comando do Dockerfile do agent) uma única vez
 * nesta suíte, e `DIFF_PATCH_ENGINE_BIN` aponta pro binário resultante
 * -- diff-patch-engine.js nunca é mockado, o subprocesso roda de
 * verdade. Sem isso, um teste com `runCommand` substituído provaria só
 * que o JS "acha" que chamou o binário certo, não que o binário em si
 * (SHA-256, parser, Myers diff) está correto -- ver
 * archive.test.js/e2e para o mesmo raciocínio já aplicado a outro
 * subprocesso/serviço externo desta base de código.
 */
let binPath;
let envSnapshot;
let tmpBuildDir;

before(async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // agent/src/utils/ -> agent/ -> raiz do repo -> Power-up/
  const repoRoot = path.resolve(here, "..", "..", "..");
  const sourcePath = path.join(repoRoot, "Power-up", "diff_patch_engine.cpp");

  tmpBuildDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "diff-patch-engine-e2e-build-"),
  );
  binPath = path.join(tmpBuildDir, "diff_patch_engine");

  await execFileAsync("g++", [
    "-std=c++17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-o",
    binPath,
    sourcePath,
  ]);

  envSnapshot = process.env.DIFF_PATCH_ENGINE_BIN;
  process.env.DIFF_PATCH_ENGINE_BIN = binPath;
});

after(async () => {
  process.env.DIFF_PATCH_ENGINE_BIN = envSnapshot;
  await fs.rm(tmpBuildDir, { recursive: true, force: true });
});

test("computeDiff + applyPatch: round-trip real -- apply(diff(A,B)) === B", async () => {
  const a = "function soma(a, b) {\n  return a + b;\n}\n";
  const b = "function soma(a, b, c) {\n  return a + b + c;\n}\n";

  const patch = await computeDiff(a, b);
  assert.equal(patch.format, "structural-token-diff-v2");
  assert.ok(typeof patch.sourceHash === "string" && patch.sourceHash.length === 64);
  assert.ok(Array.isArray(patch.ops) && patch.ops.length > 0);

  const result = await applyPatch(a, patch);
  assert.equal(result, b);
});

test("computeDiff: sourceHash bate com o SHA-256 real do conteúdo A (vetor de teste oficial)", async () => {
  const patch = await computeDiff("abc", "abc");
  assert.equal(
    patch.sourceHash,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("applyPatch: conteúdo idêntico não gera nenhuma operação delete/insert", async () => {
  const patch = await computeDiff("igual", "igual");
  assert.ok(patch.ops.every((op) => op.op === "equal"));
});

test("applyPatch: rejeita com exitCode 30 quando o conteúdo original mudou desde o diff", async () => {
  const a = "versao original\n";
  const b = "versao nova\n";
  const patch = await computeDiff(a, b);

  const aModificado = "versao original, mas alguem mexeu no meio tempo\n";

  await assert.rejects(
    () => applyPatch(aModificado, patch),
    (err) => {
      assert.ok(err instanceof DiffPatchEngineError);
      assert.equal(err.exitCode, 30);
      assert.match(err.message, /hash de origem não confere/);
      return true;
    },
  );
});

test("applyPatch: rejeita com exitCode 20 quando o patch não tem sourceHash", async () => {
  await assert.rejects(
    () => applyPatch("conteudo", { format: "structural-token-diff-v1", ops: [] }),
    (err) => {
      assert.ok(err instanceof DiffPatchEngineError);
      assert.equal(err.exitCode, 20);
      return true;
    },
  );
});

test("applyPatch: rejeita com exitCode 20 quando ops tem uma operação desconhecida", async () => {
  const patch = await computeDiff("x", "x");
  patch.ops = [{ op: "explode", text: "x" }];

  await assert.rejects(
    () => applyPatch("x", patch),
    (err) => {
      assert.ok(err instanceof DiffPatchEngineError);
      assert.equal(err.exitCode, 20);
      return true;
    },
  );
});

test("computeDiff/applyPatch: round-trip com chaves/colchetes aninhados (regressão do bug de parser já corrigido)", async () => {
  const a = "function f() {\n  const arr = [1, 2, 3];\n  return { arr };\n}\n";
  const b = "function f() {\n  const arr = [1, 2, 3, 4];\n  return { arr, ok: true };\n}\n";

  const patch = await computeDiff(a, b);
  const result = await applyPatch(a, patch);
  assert.equal(result, b);
});

test("computeDiff: arquivo maior (varias linhas) continua correto e não trava", async () => {
  const linhasA = Array.from({ length: 500 }, (_, i) => `linha ${i}`).join("\n");
  const linhasB = linhasA.replace("linha 250", "linha 250 modificada") + "\nlinha extra no fim";

  const patch = await computeDiff(linhasA, linhasB);
  const result = await applyPatch(linhasA, patch);
  assert.equal(result, linhasB);
});
