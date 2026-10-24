import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSandboxMode, sandboxSupports } from "./serviceMode.js";

test("imagem padrão mantém as duas capacidades", () => {
  assert.equal(resolveSandboxMode({}), "full");
  assert.equal(resolveSandboxMode({ SANDBOX_CHROMIUM_INSTALLED: "1" }), "full");
  assert.equal(sandboxSupports("full", "browser"), true);
  assert.equal(sandboxSupports("full", "archive"), true);
});

test("imagem sem Chromium seleciona somente extração", () => {
  const mode = resolveSandboxMode({ SANDBOX_CHROMIUM_INSTALLED: "0" });
  assert.equal(mode, "archive");
  assert.equal(sandboxSupports(mode, "archive"), true);
  assert.equal(sandboxSupports(mode, "browser"), false);
});

test("modo browser bloqueia extrações", () => {
  assert.equal(resolveSandboxMode({ SANDBOX_MODE: "browser" }), "browser");
  assert.equal(sandboxSupports("browser", "archive"), false);
});

test("configuração inválida ou browser sem Chromium falham", () => {
  for (const mode of ["full", "browser"]) {
    assert.throws(() => resolveSandboxMode({ SANDBOX_MODE: mode, SANDBOX_CHROMIUM_INSTALLED: "0" }), /exige Chromium/);
  }
  assert.throws(() => resolveSandboxMode({ SANDBOX_MODE: "invalido" }), /SANDBOX_MODE/);
  assert.throws(() => sandboxSupports("full", "invalido"), /desconhecida/);
});
