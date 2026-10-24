import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWebSandbox } from "../src/webSandbox/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mesma convenção de runWebSandbox.e2e.test.js: SANDBOX_CHROMIUM_EXECUTABLE_PATH
// setada externamente ao rodar este arquivo -- nunca aqui dentro, nunca
// via `options`.
//
// Prova, contra um Chromium REAL (não mockado), que os dois mecanismos
// de contenção adicionados em browser.js realmente funcionam: RLIMIT_CPU
// (via browserUlimitWrapper.sh) mata um processo que nunca para de
// consumir CPU, e --js-flags=--max-old-space-size mata uma aba que aloca
// memória sem limite -- nos dois casos, através da API PÚBLICA
// (runWebSandbox), confirmando que o resultado vira
// `{success:false, errors:[...]}` estruturado, nunca um travamento ou
// crash do processo do sandbox-efemoro em si (que já roda o navegador
// como processo do SO separado -- isolamento de falha inerente à
// arquitetura, não uma garantia nova desta mudança).
//
// SANDBOX_BROWSER_CPU_LIMIT_SECONDS_OVERRIDE é usado aqui de propósito,
// em vez do cálculo normal baseado em `timeout` (timeout + margem, ver
// browserCpuLimitSeconds em browser.js): por construção, esse cálculo
// NUNCA fica menor que `timeout`, então uma página com loop síncrono
// durante a navegação sempre estouraria o timeout de navegação primeiro
// -- não daria pra distinguir "RLIMIT_CPU matou o processo" de "só
// estourou o timeout normal". O override isola a causa: `timeout` fica
// bem maior que o teto de CPU, então só o RLIMIT_CPU pode ser o motivo
// da falha.

async function withFixtureServer(fixtureName, fn) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", fixtureName), "utf8");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  try {
    return await fn(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function withEnv(overrides, fn) {
  const antes = {};
  for (const chave of Object.keys(overrides)) antes[chave] = process.env[chave];
  Object.assign(process.env, overrides);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [chave, valor] of Object.entries(antes)) {
        if (valor === undefined) delete process.env[chave];
        else process.env[chave] = valor;
      }
    });
}

test(
  "RLIMIT_CPU mata um processo do navegador que nunca para de consumir CPU -- resultado estruturado, não um travamento",
  { timeout: 30000 },
  async () => {
    await withFixtureServer("cpu-bomb-page.html", (url) =>
      // Teto de CPU (2s) bem menor que o timeout de navegação (30s) --
      // se o motivo da falha fosse o timeout normal, levaria ~30s;
      // como é RLIMIT_CPU, falha em poucos segundos.
      withEnv({ SANDBOX_BROWSER_CPU_LIMIT_SECONDS_OVERRIDE: "2" }, async () => {
        const startedAt = Date.now();
        const result = await runWebSandbox({
          url,
          browser: "chromium",
          device: "desktop",
          screenshot: false,
          accessibility: false,
          timeout: 30000,
        });
        const duration = Date.now() - startedAt;

        assert.equal(result.success, false);
        assert.ok(result.errors.length > 0);
        // Achado real testando isto: um `/crash/i` solto contra a
        // mensagem INTEIRA dá falso positivo -- Playwright embute o
        // dump completo dos argumentos de lançamento do Chromium na
        // mensagem de erro (inclui `--no-crash-upload`, referências a
        // `crashpad`), então até uma falha de LANÇAMENTO sem relação
        // nenhuma com RLIMIT_CPU (ex: binário do navegador ausente)
        // "passaria" nesse teste por acidente. Só a PRIMEIRA linha
        // (a mensagem de verdade do Playwright, sem o dump de args)
        // deve ser checada, e contra o texto exato que Playwright usa
        // pra reportar um crash de página/target.
        const primeiraLinha = result.errors[0].message.split("\n")[0];
        assert.match(primeiraLinha, /page crashed|target crashed/i);
        assert.ok(
          duration < 15000,
          `falhou em ${duration}ms -- deveria ter sido o RLIMIT_CPU (2s), não o timeout de navegação (30s)`,
        );
      }),
    );
  },
);

test(
  "--js-flags=--max-old-space-size mata uma aba que aloca memória JS sem limite -- resultado estruturado, não um travamento",
  { timeout: 30000 },
  async () => {
    await withFixtureServer("heap-bomb-page.html", (url) =>
      withEnv({ SANDBOX_PAGE_JS_HEAP_LIMIT_MB: "32" }, async () => {
        const result = await runWebSandbox({
          url,
          browser: "chromium",
          device: "desktop",
          screenshot: false,
          accessibility: false,
          timeout: 30000,
        });

        assert.equal(result.success, false);
        assert.ok(result.errors.length > 0);
        // Mesma ressalva do teste de RLIMIT_CPU acima -- só a
        // primeira linha, contra o texto exato do Playwright.
        const primeiraLinha = result.errors[0].message.split("\n")[0];
        assert.match(primeiraLinha, /page crashed|target crashed/i);
      }),
    );
  },
);

test(
  "Contenção aplicada (RLIMIT_CPU + js-flags) não interfere com uma página legítima normal",
  { timeout: 30000 },
  async () => {
    await withFixtureServer("broken-page.html", async (url) => {
      // Usa os defaults de produção (sem override de env) -- prova
      // que os tetos generosos (60s de margem de CPU, 512MB de heap
      // JS) não afetam o caso comum, mesmo com o wrapper de ulimit
      // sempre no caminho de lançamento agora.
      const result = await runWebSandbox({
        url,
        browser: "chromium",
        device: "desktop",
        screenshot: true,
        accessibility: true,
      });

      assert.equal(result.success, true, JSON.stringify(result.errors));
    });
  },
);
