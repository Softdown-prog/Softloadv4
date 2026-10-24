import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAllowlist, isAllowed } from "./network.js";

test("buildAllowlist sempre inclui a URL alvo na sua própria porta", () => {
  const allowlist = buildAllowlist(new URL("http://localhost:3000/app"), []);
  assert.ok(isAllowed(allowlist, "localhost", "3000"));
  assert.ok(!isAllowed(allowlist, "localhost", "9999"));
});

test("host de loopback NÃO fica liberado em qualquer porta (achado corrigido)", () => {
  // Antes: localhost era liberado em QUALQUER porta. Agora: só a
  // porta da própria URL sob teste.
  const allowlist = buildAllowlist(new URL("http://localhost:3000/app"), []);
  assert.ok(!isAllowed(allowlist, "localhost", "5432")); // ex: outro serviço (banco?) na mesma máquina
  assert.ok(!isAllowed(allowlist, "127.0.0.1", "22"));
});

test("allowedHosts com porta explícita restringe a essa porta", () => {
  const allowlist = buildAllowlist(new URL("http://localhost:3000/"), ["api.interno.local:8443"]);
  assert.ok(isAllowed(allowlist, "api.interno.local", "8443"));
  assert.ok(!isAllowed(allowlist, "api.interno.local", "80"));
});

test("allowedHosts sem porta libera qualquer porta desse host específico", () => {
  const allowlist = buildAllowlist(new URL("http://localhost:3000/"), ["cdn.interno.local"]);
  assert.ok(isAllowed(allowlist, "cdn.interno.local", "443"));
  assert.ok(isAllowed(allowlist, "cdn.interno.local", "8080"));
});

test("host totalmente fora da allowlist é negado", () => {
  const allowlist = buildAllowlist(new URL("http://localhost:3000/"), []);
  assert.ok(!isAllowed(allowlist, "evil.example.com", "443"));
});

test("porta padrão (80/443) é usada quando a URL não especifica porta", () => {
  const allowlistHttp = buildAllowlist(new URL("http://localhost/"), []);
  assert.ok(isAllowed(allowlistHttp, "localhost", "80"));

  const allowlistHttps = buildAllowlist(new URL("https://localhost/"), []);
  assert.ok(isAllowed(allowlistHttps, "localhost", "443"));
});
