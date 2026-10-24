import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

// ── SCREENSHOT_DIR é lido de process.env no momento do import (const de
// módulo), então não dá pra testar as duas variantes (default vs
// override) importando este processo de teste diretamente -- uma vez
// importado, o valor já está fixado. Cada cenário roda num processo
// `node` filho isolado, o mesmo padrão usado em extractArchive.test.js/
// browser.test.js pra exercitar comportamento fixado no import.

const SCREENSHOTS_MODULE_URL = new URL("./screenshots.js", import.meta.url).href;

function lerScreenshotDirEmProcessoFilho(envExtra) {
  const script = `import("${SCREENSHOTS_MODULE_URL}").then(({ SCREENSHOT_DIR }) => { process.stdout.write(SCREENSHOT_DIR); });`;
  return execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, ...envExtra },
    encoding: "utf8",
  });
}

test("SCREENSHOT_DIR: default fica dentro de os.tmpdir() -- único write do serviço fora de os.tmpdir() era este, ver comentário em screenshots.js", () => {
  const dir = lerScreenshotDirEmProcessoFilho({ SANDBOX_ARTIFACTS_DIR: "" });
  assert.equal(dir, path.join(os.tmpdir(), "sandbox-efemero-screenshots"));
  assert.ok(dir.startsWith(os.tmpdir()), "default deveria estar sob os.tmpdir()");
});

test("SCREENSHOT_DIR: SANDBOX_ARTIFACTS_DIR continua sobrescrevendo o default", () => {
  const destinoCustomizado = path.join(os.tmpdir(), "destino-customizado-teste");
  const dir = lerScreenshotDirEmProcessoFilho({ SANDBOX_ARTIFACTS_DIR: destinoCustomizado });
  assert.equal(dir, destinoCustomizado);
});
