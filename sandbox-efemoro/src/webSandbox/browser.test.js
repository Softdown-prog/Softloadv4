import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { chromium, webkit } from "playwright";
import { BROWSER_ULIMIT_WRAPPER_PATH, resolveRealExecutablePath } from "./browser.js";

// ── resolveRealExecutablePath: sem lançar nenhum navegador de verdade

test("resolveRealExecutablePath: resolve pro override de env var quando definido, senão pro binário padrão do Playwright", () => {
  // Não assume que SANDBOX_CHROMIUM_EXECUTABLE_PATH/SANDBOX_WEBKIT_EXECUTABLE_PATH
  // estão ausentes -- os testes e2e deste mesmo pacote (ver
  // browserContainment.e2e.test.js) rodam com SANDBOX_CHROMIUM_EXECUTABLE_PATH
  // setada externamente (Chromium real, sem acesso ao CDN de browsers do
  // Playwright neste ambiente), então este teste precisa continuar
  // correto nos dois cenários -- variável presente ou ausente.
  const manifest = "/app/.chromium-headless-shell-path";
  const instalado = existsSync(manifest) ? readFileSync(manifest, "utf8").trim() : null;
  const esperadoChromium =
    process.env.SANDBOX_CHROMIUM_EXECUTABLE_PATH || instalado || chromium.executablePath();
  assert.equal(resolveRealExecutablePath("chromium"), esperadoChromium);
  if (instalado && !process.env.SANDBOX_CHROMIUM_EXECUTABLE_PATH) {
    assert.ok(isAbsolute(instalado), "o Dockerfile deve gravar um caminho absoluto");
  }

  const esperadoWebkit = process.env.SANDBOX_WEBKIT_EXECUTABLE_PATH || webkit.executablePath();
  assert.equal(resolveRealExecutablePath("webkit"), esperadoWebkit);
});

// ── browserUlimitWrapper.sh em isolamento -- mesmo raciocínio de
// ULIMIT_WRAPPER_SCRIPT em extractArchive.test.js: prova a defesa em
// profundidade contra qualquer falha do ulimit (não só um valor
// inválido -- também SANDBOX_BROWSER_REAL_EXECUTABLE/
// SANDBOX_BROWSER_CPU_LIMIT_SECONDS ausentes, ex: um bug futuro em
// browser.js esquecendo de setar `env`), sem precisar de um navegador
// de verdade instalado neste ambiente de teste.

test("browserUlimitWrapper.sh: aborta (exit 99) se SANDBOX_BROWSER_REAL_EXECUTABLE não estiver definida", () => {
  const result = spawnSync(BROWSER_ULIMIT_WRAPPER_PATH, [], {
    env: { ...process.env, SANDBOX_BROWSER_REAL_EXECUTABLE: "", SANDBOX_BROWSER_CPU_LIMIT_SECONDS: "60" },
  });

  assert.equal(result.status, 99);
  assert.match(result.stderr.toString("utf8"), /SANDBOX_BROWSER_REAL_EXECUTABLE/);
});

test("browserUlimitWrapper.sh: aborta (exit 99) se SANDBOX_BROWSER_CPU_LIMIT_SECONDS não estiver definida", () => {
  const result = spawnSync(BROWSER_ULIMIT_WRAPPER_PATH, [], {
    env: { ...process.env, SANDBOX_BROWSER_REAL_EXECUTABLE: "/bin/echo", SANDBOX_BROWSER_CPU_LIMIT_SECONDS: "" },
  });

  assert.equal(result.status, 99);
  assert.match(result.stderr.toString("utf8"), /SANDBOX_BROWSER_CPU_LIMIT_SECONDS/);
});

test("browserUlimitWrapper.sh: aborta (exit 99), NUNCA roda o comando, se o valor do teto de CPU for inválido", () => {
  const result = spawnSync(BROWSER_ULIMIT_WRAPPER_PATH, [], {
    env: {
      ...process.env,
      SANDBOX_BROWSER_REAL_EXECUTABLE: "/bin/echo",
      SANDBOX_BROWSER_CPU_LIMIT_SECONDS: "nao-e-um-numero",
    },
  });

  assert.equal(result.status, 99);
  assert.doesNotMatch(result.stdout.toString("utf8"), /./, "o /bin/echo nunca deveria ter rodado");
});

test("browserUlimitWrapper.sh: com env válido, aplica o ulimit e executa o binário real (argumentos preservados)", () => {
  const result = spawnSync(BROWSER_ULIMIT_WRAPPER_PATH, ["--um-argumento", "outro"], {
    env: {
      ...process.env,
      SANDBOX_BROWSER_REAL_EXECUTABLE: "/bin/echo",
      SANDBOX_BROWSER_CPU_LIMIT_SECONDS: "60",
    },
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.toString("utf8").trim(), "--um-argumento outro");
});
