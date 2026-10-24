import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Permissions } from "../security/permissions.js";
import { WebSandboxCapability } from "./web-sandbox.js";

let envSnapshot;

beforeEach(() => {
  envSnapshot = { ...process.env };
  process.env.SANDBOX_SERVICE_URL = "https://sandbox.exemplo.internal";
  process.env.SANDBOX_SHARED_SECRET = "segredo-teste";
});

afterEach(() => {
  process.env = envSnapshot;
});

function respostaJson(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}

function makeCapability(fetchImpl, permissionsOverride) {
  const permissions = new Permissions({
    mode: "full",
    ...(permissionsOverride || {}),
  });
  return new WebSandboxCapability({ permissions, fetchImpl });
}

test("websandbox.run exige url", async () => {
  const capability = makeCapability(async () => respostaJson(200, {}));

  await assert.rejects(
    () => capability.execute({ type: "websandbox.run" }),
    /exige url/,
  );
});

test("websandbox.run lança erro claro quando SANDBOX_SERVICE_URL não está configurada", async () => {
  delete process.env.SANDBOX_SERVICE_URL;
  const capability = makeCapability(async () => respostaJson(200, {}));

  await assert.rejects(
    () => capability.execute({ type: "websandbox.run", url: "http://localhost:3000" }),
    /SANDBOX_SERVICE_URL não configurada/,
  );
});

test("websandbox.run chama POST /run com o header de segredo e repassa o resultado", async () => {
  const chamadas = [];
  const capability = makeCapability(async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return respostaJson(200, { success: true, screenshotPath: "x.png" });
  });

  const result = await capability.execute({
    type: "websandbox.run",
    url: "http://localhost:3000",
    device: "iphone",
  });

  assert.deepEqual(result, { success: true, screenshotPath: "x.png" });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "https://sandbox.exemplo.internal/run");
  assert.equal(chamadas[0].opcoes.headers["x-sandbox-secret"], "segredo-teste");

  const corpoEnviado = JSON.parse(chamadas[0].opcoes.body);
  assert.deepEqual(corpoEnviado, { url: "http://localhost:3000", device: "iphone" });
});

test("websandbox.run nunca manda campos undefined no corpo (deixa o serviço aplicar os próprios defaults)", async () => {
  let corpoEnviado;
  const capability = makeCapability(async (url, opcoes) => {
    corpoEnviado = JSON.parse(opcoes.body);
    return respostaJson(200, { success: true });
  });

  await capability.execute({ type: "websandbox.run", url: "http://localhost:3000" });

  assert.deepEqual(corpoEnviado, { url: "http://localhost:3000" });
});

test("websandbox.run propaga como exceção uma falha de INFRAESTRUTURA (HTTP não-ok)", async () => {
  const capability = makeCapability(async () =>
    respostaJson(401, { error: "não autenticado" }),
  );

  await assert.rejects(
    () => capability.execute({ type: "websandbox.run", url: "http://localhost:3000" }),
    /401.*não autenticado/,
  );
});

test("websandbox.run NÃO lança quando a auditoria em si falhou (HTTP 200, success:false)", async () => {
  const capability = makeCapability(async () =>
    respostaJson(200, { success: false, errors: [{ message: "página não carregou" }] }),
  );

  const result = await capability.execute({
    type: "websandbox.run",
    url: "http://localhost:3000",
  });

  assert.equal(result.success, false);
});

test("websandbox.run funciona sem SANDBOX_SHARED_SECRET (não manda o header)", async () => {
  delete process.env.SANDBOX_SHARED_SECRET;
  let headersRecebidos;
  const capability = makeCapability(async (url, opcoes) => {
    headersRecebidos = opcoes.headers;
    return respostaJson(200, { success: true });
  });

  await capability.execute({ type: "websandbox.run", url: "http://localhost:3000" });
  assert.equal(headersRecebidos["x-sandbox-secret"], undefined);
});

test("websandbox.run respeita Permissions -- negado por padrão (preset restricted)", async () => {
  const capability = makeCapability(
    async () => respostaJson(200, { success: true }),
    { mode: "restricted" },
  );

  await assert.rejects(
    () => capability.execute({ type: "websandbox.run", url: "http://localhost:3000" }),
    /Permissão negada/,
  );
});

test("websandbox.run usa URL e segredo exclusivos do navegador", async () => {
  process.env.SANDBOX_BROWSER_SERVICE_URL = "https://browser.internal/";
  process.env.SANDBOX_BROWSER_SHARED_SECRET = "segredo-browser";
  let chamada;
  const capability = makeCapability(async (url, options) => {
    chamada = { url, options };
    return respostaJson(200, { success: true });
  });
  await capability.execute({ type: "websandbox.run", url: "https://example.org" });
  assert.equal(chamada.url, "https://browser.internal/run");
  assert.equal(chamada.options.headers["x-sandbox-secret"], "segredo-browser");
});

test("websandbox.run aceita URL dedicada sem URL legada", async () => {
  delete process.env.SANDBOX_SERVICE_URL;
  process.env.SANDBOX_BROWSER_SERVICE_URL = "https://browser.internal";
  const capability = makeCapability(async url => {
    assert.equal(url, "https://browser.internal/run");
    return respostaJson(200, { success: true });
  });
  await capability.execute({ type: "websandbox.run", url: "https://example.org" });
});
