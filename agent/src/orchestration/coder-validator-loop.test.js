import { test } from "node:test";
import assert from "node:assert/strict";
import { CoderValidatorLoop, MaxAttemptsExceededError } from "./coder-validator-loop.js";

test("coder-validator: passa na primeira tentativa e conserva o comando de teste", async () => {
  const executed = [];
  const validatorAgent = {
    async execute(task) {
      executed.push(task);
      return { ok: true, result: { exitCode: 0, stdout: "ok", stderr: "" } };
    },
  };
  const ctx = [];
  const loop = new CoderValidatorLoop({ validatorAgent, testCommand: "npm test", maxAttempts: 3 });
  const result = await loop.run({ plan: { id: "feature" }, onCoderStep: async context => {
    ctx.push(context);
    return { changed: 1 };
  } });
  assert.equal(result.success, true);
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.coderResult, { changed: 1 });
  assert.equal(ctx[0].previousFeedback, null);
  assert.deepEqual(executed, [{ type: "shell.execute", command: "npm test", timeoutMs: undefined }]);
});

test("coder-validator: reaproveita stdout, stderr e exitCode real na segunda tentativa", async () => {
  let checks = 0;
  const contexts = [];
  const loop = new CoderValidatorLoop({
    validatorAgent: {
      async execute() {
        checks += 1;
        return checks === 1
          ? { ok: true, result: { exitCode: 7, stdout: "falha", stderr: "stack trace" } }
          : { ok: true, result: { exitCode: 0, stdout: "passou", stderr: "" } };
      },
    },
    testCommand: "npm test",
    maxAttempts: 2,
  });
  const result = await loop.run({ plan: null, onCoderStep: async ctx => {
    contexts.push(ctx);
    return null;
  } });
  assert.equal(result.attempts, 2);
  assert.equal(contexts.length, 2);
  assert.deepEqual(contexts[1].previousFeedback, { exitCode: 7, stdout: "falha", stderr: "stack trace" });
});

test("coder-validator: callback de falha antes do erro com todas as tentativas", async () => {
  let failure;
  let checks = 0;
  const loop = new CoderValidatorLoop({
    validatorAgent: { async execute() { checks++; return { ok: false, error: { message: "sem permissão" } }; } },
    testCommand: "npm test",
    maxAttempts: 2,
    onFailure: async (context) => { failure = context; },
  });
  await assert.rejects(
    () => loop.run({ plan: {}, onCoderStep: async () => "editado" }),
    error => {
      assert.ok(error instanceof MaxAttemptsExceededError);
      assert.equal(error.attempts, 2);
      assert.equal(error.code, "MAX_ATTEMPTS_EXCEEDED");
      return true;
    },
  );
  assert.equal(checks, 2);
  assert.deepEqual(failure.lastFeedback, { exitCode: null, stdout: "", stderr: "sem permissão" });
  assert.equal(failure.attempts, 2);
});

test("coder-validator: valida parâmetros antes de iniciar tarefas", async () => {
  assert.throws(() => new CoderValidatorLoop({ testCommand: "npm test" }), /validatorAgent/);
  assert.throws(() => new CoderValidatorLoop({ validatorAgent: { execute: async () => ({ ok: true }) } }), /testCommand/);
  const loop = new CoderValidatorLoop({ validatorAgent: { execute: async () => ({ ok: true }) }, testCommand: "npm test" });
  await assert.rejects(() => loop.run({ plan: null }), /onCoderStep/);
});
