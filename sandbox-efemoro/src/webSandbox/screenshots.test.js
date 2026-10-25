import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { captureScreenshot, MAX_INLINE_SCREENSHOT_BYTES } from "./screenshots.js";

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

test("inline: retorna PNG em base64 sem gravar arquivo e sem vazar caminho interno", async () => {
  const png = Buffer.from("89504e470d0a1a0a11223344", "hex");
  const calls = [];
  const page = {
    viewportSize: () => ({ width: 800, height: 600 }),
    evaluate: async () => ({ width: 800, height: 600 }),
    screenshot: async (options) => { calls.push(options); return png; },
  };
  const result = await captureScreenshot(page, "chromium", "desktop", { delivery: "inline" });
  assert.equal(result.error, null);
  assert.equal(result.path, null);
  assert.equal(result.screenshot.mimeType, "image/png");
  assert.equal(result.screenshot.bytes, png.length);
  assert.equal(result.screenshot.fullPage, true);
  assert.deepEqual(Buffer.from(result.screenshot.dataBase64, "base64"), png);
  assert.deepEqual(calls, [{ type: "png", fullPage: true }]);
});

test("inline: página gigante captura viewport para impedir alocação enorme", async () => {
  const page = {
    viewportSize: () => ({ width: 1366, height: 768 }),
    evaluate: async () => ({ width: 1366, height: 1000000 }),
    screenshot: async ({ fullPage }) => {
      assert.equal(fullPage, false);
      return Buffer.from("89504e470d0a1a0a", "hex");
    },
  };
  const result = await captureScreenshot(page, "chromium", "desktop", { delivery: "inline" });
  assert.equal(result.error, null);
  assert.equal(result.screenshot.fullPage, false);
});

test("inline: PNG enorme recua para viewport ou falha com teto de 4 MiB", async () => {
  const tooLarge = Buffer.alloc(MAX_INLINE_SCREENSHOT_BYTES + 1, 0);
  const page = {
    viewportSize: () => ({ width: 800, height: 600 }),
    evaluate: async () => ({ width: 800, height: 600 }),
    screenshot: async () => tooLarge,
  };
  const result = await captureScreenshot(page, "chromium", "desktop", { delivery: "inline" });
  assert.equal(result.path, null);
  assert.equal(result.screenshot, undefined);
  assert.match(result.error, /limite de 4 MiB/);
});

test("path legado continua gravando PNG sem base64 na resposta", async () => {
  const page = {
    screenshot: async (options) => {
      assert.equal(options.fullPage, true);
      assert.equal(typeof options.path, "string");
      return Buffer.alloc(0);
    },
  };
  const result = await captureScreenshot(page, "chromium", "desktop");
  assert.equal(result.error, null);
  assert.ok(result.path?.endsWith("_chromium_desktop.png"));
  assert.equal(result.screenshot, undefined);
});

test("inline viewport: captura somente a tela sem medir página inteira", async () => {
  const png = Buffer.from("89504e470d0a1a0a11223344", "hex");
  const calls = [];
  const page = {
    screenshot: async options => { calls.push(options); return png; },
  };
  const result = await captureScreenshot(page, "chromium", "desktop", {
    delivery: "inline", mode: "viewport",
  });
  assert.equal(result.error, null);
  assert.equal(result.screenshot.fullPage, false);
  assert.deepEqual(calls, [{ type: "png", fullPage: false }]);
});
