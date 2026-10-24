import { test } from "node:test";
import assert from "node:assert/strict";
import { positiveIntEnvOverride } from "./envInt.js";

function withEnv(name, value, fn) {
  const antes = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (antes === undefined) delete process.env[name];
    else process.env[name] = antes;
  }
}

test("positiveIntEnvOverride: variável ausente devolve o default", () => {
  withEnv("SANDBOX_TEST_ENV_INT", undefined, () => {
    assert.equal(positiveIntEnvOverride("SANDBOX_TEST_ENV_INT", 42), 42);
  });
});

test("positiveIntEnvOverride: inteiro positivo válido é aceito", () => {
  withEnv("SANDBOX_TEST_ENV_INT", "100", () => {
    assert.equal(positiveIntEnvOverride("SANDBOX_TEST_ENV_INT", 42), 100);
  });
});

test("positiveIntEnvOverride: valores inválidos (zero, negativo, não numérico, fracionário) caem no default", () => {
  for (const valor of ["0", "-5", "nao-e-numero", "3.5", ""]) {
    withEnv("SANDBOX_TEST_ENV_INT", valor, () => {
      assert.equal(positiveIntEnvOverride("SANDBOX_TEST_ENV_INT", 42), 42, `valor "${valor}" deveria cair no default`);
    });
  }
});
