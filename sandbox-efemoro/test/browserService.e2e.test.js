// Teste offline de ponta a ponta da API pública do sandbox.
// Executar dentro da imagem construída, montando /app/test como read-only.
// Prova que a imagem mínima conserva prints, auditoria axe, console,
// responsividade e política de rede, sem exposição de portas nem Internet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageHtml = readFileSync(path.join(here, "fixtures/broken-page.html"), "utf8");
const secret = "isolated-ci-only-secret";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function waitForHealth(baseUrl, child, getLog) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`sandbox server exited early (${child.exitCode}): ${getLog()}`);
    }
    try {
      const response = await fetch(baseUrl + "/health", {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      // Aguardando porta ficar pronta; nenhum tráfego externo.
    }
    await delay(100);
  }
  throw new Error("sandbox server not ready: " + getLog());
}

test("headless-shell API: autenticação, screenshot, auditorias desktop/mobile e bloqueio de metadata", { timeout: 90000 }, async (t) => {
  const fixture = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  const fixturePort = await listen(fixture);
  t.after(() => new Promise((resolve) => fixture.close(resolve)));

  // Servidor real do mesmo container, com chave de teste e porta loopback.
  // Nada escuta na rede pública: o CI roda este container com --network none.
  const reserve = createServer((_req, res) => res.end());
  const apiPort = await listen(reserve);
  await new Promise((resolve) => reserve.close(resolve));
  const child = spawn(process.execPath, ["/app/src/server.js"], {
    env: { ...process.env, PORT: String(apiPort), SANDBOX_SHARED_SECRET: secret },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => {
      logs = (logs + data.toString()).slice(-10000);
    });
  }
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  const baseUrl = `http://127.0.0.1:${apiPort}`;
  await waitForHealth(baseUrl, child, () => logs);

  const post = (payload, headers = { "x-sandbox-secret": secret }) =>
    fetch(baseUrl + "/run", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000),
    });
  const targetUrl = `http://127.0.0.1:${fixturePort}/`;


  await t.test("health expõe a capacidade browser sem segredos", async () => {
    const response = await fetch(baseUrl + "/health");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "ok");
    assert.equal(data.capabilities.browser, true);
    assert.equal(data.capabilities.archive, true);
    assert.equal(JSON.stringify(data).includes(secret), false);
  });

  await t.test("bloqueia requisições sem segredo", async () => {
    const response = await post({ url: targetUrl }, { "x-sandbox-secret": "errado" });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  });

  for (const device of ["desktop", "android-mobile"]) {
    await t.test(`navegador completo: ${device}`, async () => {
      const response = await post({
        url: targetUrl,
        browser: "chromium",
        device,
        screenshot: true,
        accessibility: true,
        timeout: 20000,
        // Tentativa maliciosa: não pode sobrescrever caminho do executável.
        browserExecutablePath: "/bin/echo",
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.success, true, JSON.stringify(result.errors));
      assert.equal(result.device, device);
      assert.equal(result.browser, "chromium");
      assert.equal(result.viewport.width, device === "desktop" ? 1366 : 360);
      assert.equal(result.responsive.horizontalOverflow, true);
      assert.ok(result.console.errors.some((entry) => entry.text.includes("erro deliberado de teste")));
      assert.ok(result.security.blockedRequests.some((entry) => entry.hostname === "exemplo-nao-permitido.invalid"));
      assert.ok(result.accessibility.violations.some((entry) => entry.id === "image-alt"),
        JSON.stringify(result.accessibility));
      assert.ok(result.screenshotPath && existsSync(result.screenshotPath), "PNG não criado");
      const screenshot = readFileSync(result.screenshotPath);
      assert.ok(screenshot.length > 100);
      assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      unlinkSync(result.screenshotPath);
    });
  }

  await t.test("PNG inline chega pelo HTTP sem caminho do filesystem", async () => {
    const response = await post({
      url: targetUrl,
      browser: "chromium",
      device: "android-mobile",
      screenshot: true,
      screenshotDelivery: "inline",
      accessibility: false,
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.equal(result.screenshotPath, null);
    assert.equal(result.screenshot.mimeType, "image/png");
    assert.equal(result.screenshot.fullPage, true);
    const decoded = Buffer.from(result.screenshot.dataBase64, "base64");
    assert.equal(result.screenshot.bytes, decoded.length);
    assert.ok(decoded.length > 100);
    assert.deepEqual([...decoded.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });

  await t.test("modo screenshot=false não devolve PNG", async () => {
    const response = await post({
      url: targetUrl,
      screenshot: false,
      screenshotDelivery: "inline",
      accessibility: false,
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.equal(result.screenshot, null);
    assert.equal(result.screenshotPath, null);
  });

  await t.test("recusa metadata de nuvem antes de navegar", async () => {
    const response = await post({ url: "http://169.254.169.254/latest/meta-data/" });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, false);
    assert.ok(result.errors.some((entry) => entry.message.includes("sempre bloqueado")));
  });
});
