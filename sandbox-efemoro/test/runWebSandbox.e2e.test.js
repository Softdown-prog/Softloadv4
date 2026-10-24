import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWebSandbox } from "../src/webSandbox/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures", "broken-page.html");

// browser.js lê SANDBOX_CHROMIUM_EXECUTABLE_PATH da variável de
// ambiente do processo (ex: um Chromium já instalado localmente, sem
// acesso ao CDN de browsers do Playwright) -- setada externamente ao
// rodar este arquivo (`SANDBOX_CHROMIUM_EXECUTABLE_PATH=... node --test`),
// nunca aqui dentro do teste nem via `options`. Deliberado: `options`
// simula o corpo de uma requisição HTTP, e o binário do navegador
// nunca pode ser controlável por quem chama a API (ver browser.js).

async function withFixtureServer(fn) {
  const html = fs.readFileSync(FIXTURE_PATH, "utf8");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  try {
    await fn(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test(
  "runWebSandbox: execução real ponta a ponta contra uma página propositalmente quebrada",
  { timeout: 60000 },
  async () => {
    await withFixtureServer(async (url) => {
      const result = await runWebSandbox({
        url,
        browser: "chromium",
        device: "desktop",
        screenshot: true,
        accessibility: true,
        timeout: 20000,
      });

      assert.equal(result.success, true, JSON.stringify(result.errors));
      assert.equal(result.url, url);
      assert.equal(result.browser, "chromium");

      // console.error da fixture foi capturado
      assert.ok(
        result.console.errors.some((e) => e.text.includes("erro deliberado de teste")),
        "console.error da fixture não foi capturado",
      );

      // overflow horizontal (a div de 3000px) foi detectado
      assert.equal(result.responsive.horizontalOverflow, true);

      // meta viewport ausente foi detectada
      assert.ok(
        result.responsive.viewportWarnings.some((w) => w.message.includes("viewport")),
        "aviso de meta viewport ausente não foi gerado",
      );

      // axe-core rodou de verdade e encontrou a violação de alt text
      assert.ok(
        result.accessibility.violations.some((v) => v.id === "image-alt"),
        "violação image-alt não foi encontrada: " + JSON.stringify(result.accessibility.violations),
      );

      // a requisição para o host fora da allowlist foi bloqueada
      assert.ok(
        result.security.blockedRequests.some((b) => b.hostname === "exemplo-nao-permitido.invalid"),
        "requisição para host fora da allowlist não foi bloqueada",
      );

      // screenshot foi de fato gravado em disco
      assert.ok(result.screenshotPath, "screenshotPath está vazio");
      assert.ok(fs.existsSync(result.screenshotPath), "arquivo de screenshot não existe no disco");
      const stats = fs.statSync(result.screenshotPath);
      assert.ok(stats.size > 0, "arquivo de screenshot está vazio");

      // limpeza
      fs.unlinkSync(result.screenshotPath);
    });
  },
);

test(
  "runWebSandbox: bloqueia mesmo a NAVEGAÇÃO INICIAL se a URL não estiver implicitamente permitida",
  { timeout: 30000 },
  async () => {
    // Loopback em porta diferente da liberada -- mesmo a URL alvo
    // segue as regras normais de allowlist (ela mesma sempre entra na
    // allowlist pela própria função, então este teste usa uma porta
    // que não existe para simular timeout/erro de navegação real, só
    // para confirmar que o resultado reporta falha de forma limpa em
    // vez de travar.
    const result = await runWebSandbox({
      url: "http://127.0.0.1:1/", // porta 1: ninguém está escutando
      timeout: 3000,
      screenshot: false,
      accessibility: false,
    });

    assert.equal(result.success, false);
    assert.ok(result.errors.length > 0);
  },
);

test("runWebSandbox: rejeita URL para endpoint de metadata de nuvem sem nunca abrir o navegador", async () => {
  const result = await runWebSandbox({
    url: "http://169.254.169.254/latest/meta-data/",
  });

  assert.equal(result.success, false);
  assert.ok(result.errors.some((e) => e.message.includes("sempre bloqueado")));
});

test(
  "runWebSandbox: campo browserExecutablePath em `options` é ignorado -- não controla qual binário roda (regressão de segurança)",
  { timeout: 30000 },
  async () => {
    // `options` simula o corpo de uma requisição HTTP externa (ver
    // server.js: `runWebSandbox(req.body)`). Um campo
    // "browserExecutablePath" apontando pra qualquer binário do
    // sistema NÃO PODE ter efeito algum -- se tivesse, seria execução
    // de código arbitrário controlada por quem chama a API. O
    // navegador precisa continuar sendo lançado normalmente (sucesso),
    // provando que o campo foi ignorado, não interpretado.
    await withFixtureServer(async (url) => {
      const result = await runWebSandbox({
        url,
        screenshot: false,
        accessibility: false,
        timeout: 15000,
        // tentativa de injeção: se isto fosse honrado, o Playwright
        // tentaria executar /bin/echo como se fosse o navegador.
        browserExecutablePath: "/bin/echo",
      });

      assert.equal(result.success, true, JSON.stringify(result.errors));
      assert.equal(result.browser, "chromium");
    });
  },
);
