import { test } from "node:test";
import assert from "node:assert/strict";
import { getDeviceConfig, MIN_DIMENSION, MAX_DIMENSION } from "./devices.js";

test("getDeviceConfig retorna o device padrão para nome desconhecido", () => {
  const config = getDeviceConfig("nao-existe", null);
  assert.equal(config.viewport.width, 1366);
  assert.equal(config.viewport.height, 768);
});

test("getDeviceConfig aplica override de viewport válido", () => {
  const config = getDeviceConfig("desktop", { width: 800, height: 600 });
  assert.equal(config.viewport.width, 800);
  assert.equal(config.viewport.height, 600);
});

test("getDeviceConfig rejeita override não-objeto", () => {
  assert.throws(() => getDeviceConfig("desktop", "800x600"), /objeto/);
});

test("getDeviceConfig rejeita dimensões abaixo do mínimo", () => {
  assert.throws(() => getDeviceConfig("desktop", { width: 1, height: 600 }), /width inválido/);
});

test("getDeviceConfig rejeita dimensões acima do máximo (proteção de DoS por screenshot gigante)", () => {
  assert.throws(
    () => getDeviceConfig("desktop", { width: 999999, height: 600 }),
    /width inválido/,
  );
});

test("getDeviceConfig rejeita dimensões não-inteiras", () => {
  assert.throws(() => getDeviceConfig("desktop", { width: 800.5, height: 600 }), /width inválido/);
});

test("MIN_DIMENSION e MAX_DIMENSION são consistentes", () => {
  assert.ok(MIN_DIMENSION < MAX_DIMENSION);
});
