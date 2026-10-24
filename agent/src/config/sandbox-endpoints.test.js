import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSandboxEndpoint } from "./sandbox-endpoints.js";

test("configuração legada atende web e arquivo", () => {
  const env = { SANDBOX_SERVICE_URL: "https://antigo/", SANDBOX_SHARED_SECRET: "token" };
  assert.deepEqual(resolveSandboxEndpoint("browser", env), { serviceUrl: "https://antigo", secret: "token" });
  assert.deepEqual(resolveSandboxEndpoint("archive", env), { serviceUrl: "https://antigo", secret: "token" });
});

test("URLs dedicadas nunca se misturam", () => {
  const env = {
    SANDBOX_SERVICE_URL: "https://antigo",
    SANDBOX_SHARED_SECRET: "antigo",
    SANDBOX_BROWSER_SERVICE_URL: "https://browser/",
    SANDBOX_ARCHIVE_SERVICE_URL: "https://archive/",
    SANDBOX_BROWSER_SHARED_SECRET: "b",
    SANDBOX_ARCHIVE_SHARED_SECRET: "a",
  };
  assert.deepEqual(resolveSandboxEndpoint("browser", env), { serviceUrl: "https://browser", secret: "b" });
  assert.deepEqual(resolveSandboxEndpoint("archive", env), { serviceUrl: "https://archive", secret: "a" });
});

test("URL específica funciona sem a configuração antiga", () => {
  assert.deepEqual(resolveSandboxEndpoint("archive", { SANDBOX_ARCHIVE_SERVICE_URL: "http://archive:8080" }), {
    serviceUrl: "http://archive:8080",
    secret: undefined,
  });
  assert.throws(() => resolveSandboxEndpoint("invalid", {}), /desconhecida/);
});
