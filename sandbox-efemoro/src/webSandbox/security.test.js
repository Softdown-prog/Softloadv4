import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOptions, validateUrl, validateAllowedHosts } from "./security.js";

test("validateUrl aceita http/https", () => {
  assert.equal(validateUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(validateUrl("https://localhost:3000/x"), "https://localhost:3000/x");
});

test("validateUrl rejeita protocolo não http/https", () => {
  assert.throws(() => validateUrl("file:///etc/passwd"), /http\/https/);
  assert.throws(() => validateUrl("ftp://localhost"), /http\/https/);
});

test("validateUrl rejeita string vazia/ausente", () => {
  assert.throws(() => validateUrl(""), /required/);
  assert.throws(() => validateUrl(undefined), /required/);
});

test("validateUrl rejeita URL malformada", () => {
  assert.throws(() => validateUrl("não é uma url"), /Invalid URL/);
});

test("validateUrl rejeita endpoint de metadata de nuvem mesmo como alvo direto", () => {
  assert.throws(
    () => validateUrl("http://169.254.169.254/latest/meta-data/"),
    /sempre bloqueado/,
  );
  assert.throws(() => validateUrl("http://metadata.google.internal/"), /sempre bloqueado/);
});

test("validateAllowedHosts aceita host simples e host:porta", () => {
  const result = validateAllowedHosts(["example.com", "internal.local:9000"]);
  assert.deepEqual(result, ["example.com", "internal.local:9000"]);
});

test("validateAllowedHosts rejeita entrada de metadata mesmo com porta", () => {
  assert.throws(
    () => validateAllowedHosts(["169.254.169.254:80"]),
    /endpoint de metadata/,
  );
});

test("validateAllowedHosts rejeita entradas não-string", () => {
  assert.throws(() => validateAllowedHosts([123]), /string/);
});

test("validateOptions aplica defaults consistentes", () => {
  const result = validateOptions({ url: "http://localhost:3000" });
  assert.equal(result.browserType, "chromium");
  assert.equal(result.device, "desktop");
  assert.equal(result.screenshot, true);
  assert.equal(result.accessibility, true);
  assert.equal(result.timeout, 30000);
  assert.deepEqual(result.allowedHosts, []);
});

test("validateOptions rejeita objeto ausente/inválido", () => {
  assert.throws(() => validateOptions(null), /Options object/);
  assert.throws(() => validateOptions("x"), /Options object/);
  assert.throws(() => validateOptions([1, 2]), /Options object/);
});

test("validateOptions ignora browser/device fora da allowlist e usa default", () => {
  const result = validateOptions({ url: "http://localhost:3000", browser: "firefox", device: "vr-headset" });
  assert.equal(result.browserType, "chromium");
  assert.equal(result.device, "desktop");
});

test("validateOptions clampa timeout fora do intervalo permitido para o default", () => {
  const tooLow = validateOptions({ url: "http://localhost:3000", timeout: 1 });
  const tooHigh = validateOptions({ url: "http://localhost:3000", timeout: 999999999 });
  assert.equal(tooLow.timeout, 30000);
  assert.equal(tooHigh.timeout, 30000);
});

test("screenshotDelivery: conserva contrato path e aceita inline somente quando explícito", () => {
  const base = { url: "http://localhost:3000" };
  assert.equal(validateOptions(base).screenshotDelivery, "path");
  assert.equal(validateOptions({ ...base, screenshotDelivery: "inline" }).screenshotDelivery, "inline");
  assert.throws(() => validateOptions({ ...base, screenshotDelivery: "url" }), /screenshotDelivery/);
  assert.throws(() => validateOptions({ ...base, screenshotDelivery: 123 }), /screenshotDelivery/);
});
