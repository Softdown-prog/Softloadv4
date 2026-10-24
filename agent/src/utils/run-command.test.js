import { test } from "node:test";
import assert from "node:assert/strict";
import { runCommand, truncateOutput } from "./run-command.js";

test("runCommand: por padrão remove um '\\n' final do stdout (comportamento já esperado por build.js/test.js/etc)", async () => {
  const result = await runCommand("printf", ["linha1\\nlinha2\\n"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "linha1\nlinha2");
});

test("runCommand: stripFinalNewline:false preserva o '\\n' final -- necessário quando stdout é o CONTEÚDO de um arquivo, não um log (ver diff-patch-engine.js)", async () => {
  const result = await runCommand("printf", ["linha1\\nlinha2\\n"], {
    stripFinalNewline: false,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "linha1\nlinha2\n");
});

test("runCommand: exit code != 0 não lança, devolve failed:true", async () => {
  const result = await runCommand("sh", ["-c", "exit 7"]);

  assert.equal(result.exitCode, 7);
  assert.equal(result.failed, true);
});

test("truncateOutput: string menor que o limite volta intacta", () => {
  assert.equal(truncateOutput("abc", 10), "abc");
});

test("truncateOutput: string maior que o limite é cortada, mantendo o FIM", () => {
  const texto = "a".repeat(100) + "FIM";
  const cortado = truncateOutput(texto, 40);

  assert.ok(cortado.length <= 40);
  assert.ok(cortado.endsWith("FIM"));
  assert.match(cortado, /^\.\.\.\[saída truncada\]/);
});
