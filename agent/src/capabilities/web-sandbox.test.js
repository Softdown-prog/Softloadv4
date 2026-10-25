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
  assert.deepEqual(corpoEnviado, { url: "http://localhost:3000", device: "iphone", screenshotDelivery: "inline" });
});

test("websandbox.run nunca manda campos undefined no corpo (deixa o serviço aplicar os próprios defaults)", async () => {
  let corpoEnviado;
  const capability = makeCapability(async (url, opcoes) => {
    corpoEnviado = JSON.parse(opcoes.body);
    return respostaJson(200, { success: true });
  });

  await capability.execute({ type: "websandbox.run", url: "http://localhost:3000" });

  assert.deepEqual(corpoEnviado, { url: "http://localhost:3000", screenshotDelivery: "inline" });
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

test("websandbox.run recebe PNG inline verificável e não depende do path do container", async () => {
  const png = Buffer.from("89504e470d0a1a0a0a000000", "hex");
  const screenshot = {
    mimeType: "image/png",
    dataBase64: png.toString("base64"),
    bytes: png.length,
    fullPage: true,
  };
  const capability = makeCapability(async (_url, options) => {
    assert.equal(JSON.parse(options.body).screenshotDelivery, "inline");
    return respostaJson(200, { success: true, screenshotPath: null, screenshot });
  });
  const result = await capability.execute({ type: "websandbox.run", url: "https://example.org" });
  assert.equal(result.screenshotPath, null);
  assert.deepEqual(Buffer.from(result.screenshot.dataBase64, "base64"), png);
});

test("websandbox.run não pede PNG quando screenshot=false", async () => {
  const capability = makeCapability(async (_url, options) => {
    assert.equal(JSON.parse(options.body).screenshotDelivery, undefined);
    return respostaJson(200, { success: true, screenshot: null });
  });
  await capability.execute({ type: "websandbox.run", url: "https://example.org", screenshot: false });
});

test("websandbox.run bloqueia PNG base64 inválido ou acima do limite", async () => {
  const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const invalidCases = [
    { mimeType: "text/html", dataBase64: png.toString("base64"), bytes: png.length, fullPage: true },
    { mimeType: "image/png", dataBase64: "AAAA", bytes: 3, fullPage: true },
    { mimeType: "image/png", dataBase64: png.toString("base64"), bytes: 123, fullPage: true },
    { mimeType: "image/png", dataBase64: png.toString("base64"), bytes: png.length, fullPage: "sim" },
  ];
  for (const screenshot of invalidCases) {
    const capability = makeCapability(async () => respostaJson(200, { success: true, screenshot }));
    await assert.rejects(
      () => capability.execute({ type: "websandbox.run", url: "https://example.org" }),
      /PNG inline inválido/,
    );
  }
});
