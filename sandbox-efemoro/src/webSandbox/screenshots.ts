import path from "node:path";
import type { Page } from "playwright";

export type ScreenshotDelivery = "path" | "inline";
export type ScreenshotMode = "auto" | "viewport";
export interface ScreenshotCaptureOptions { delivery?: ScreenshotDelivery; mode?: ScreenshotMode }
export interface InlinePng {
  mimeType: "image/png";
  dataBase64: string;
  bytes: number;
  fullPage: boolean;
}
export interface ScreenshotCaptureResult { path: string | null; error: string | null; screenshot?: InlinePng }

import fs from "node:fs";
import os from "node:os";

// O caminho legado existe apenas dentro do container do sandbox.
// Entrega inline dispensa arquivos persistidos e permite que o Agent
// (outro container) receba os pixels efetivos na resposta HTTP.
const SCREENSHOT_DIR =
  process.env.SANDBOX_ARTIFACTS_DIR ||
  path.join(os.tmpdir(), "sandbox-efemero-screenshots");

// Limites fixos na fronteira do serviço: não são controlados pela página
// nem por opções de uma requisição não confiável.
const MAX_INLINE_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_SCREENSHOT_PIXELS = 16_000_000;
const MAX_INLINE_SCREENSHOT_HEIGHT = 8192;

async function shouldCaptureFullPage(page: Page): Promise<boolean> {
  try {
    const viewport = page.viewportSize();
    if (!viewport) return false;
    const { width, height } = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      return {
        width: Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0),
        height: Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0),
      };
    });
    const imageWidth = Math.max(viewport.width, width);
    const imageHeight = Math.max(viewport.height, height);
    return (
      Number.isSafeInteger(imageWidth) &&
      Number.isSafeInteger(imageHeight) &&
      imageHeight <= MAX_INLINE_SCREENSHOT_HEIGHT &&
      imageWidth * imageHeight <= MAX_INLINE_SCREENSHOT_PIXELS
    );
  } catch {
    // Página adversarial ou desmontada: screenshot do viewport é a
    // alternativa limitada e segura.
    return false;
  }
}

/**
 * Screenshot legada em arquivo ou PNG inline (base64).
 * A entrega inline nunca grava PNG em disco e limita bytes/pixels.
 * @param {import('playwright').Page} page
 * @param {string} browserType
 * @param {string} device
 * @param {{delivery?: "path"|"inline"}} options
 */
async function captureScreenshot(page: Page, browserType: string, device: string, { delivery = "path", mode = "auto" }: ScreenshotCaptureOptions = {}): Promise<ScreenshotCaptureResult> {
  try {
    if (delivery === "inline") {
      let fullPage = mode === "viewport" ? false : await shouldCaptureFullPage(page);
      let png = await page.screenshot({ type: "png", fullPage });
      // Páginas visualmente muito complexas ainda podem exceder o
      // limite de bytes; tenta o viewport sem gravar em /tmp.
      if (png.length > MAX_INLINE_SCREENSHOT_BYTES && fullPage) {
        fullPage = false;
        png = await page.screenshot({ type: "png", fullPage: false });
      }
      if (png.length > MAX_INLINE_SCREENSHOT_BYTES) {
        throw new Error("Screenshot ultrapassou o limite de 4 MiB para entrega inline");
      }
      return {
        path: null,
        error: null,
        screenshot: {
          mimeType: "image/png",
          dataBase64: png.toString("base64"),
          bytes: png.length,
          fullPage,
        },
      };
    }

    if (delivery !== "path") {
      throw new Error("Modo de entrega de screenshot inválido");
    }
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const filename = `${Date.now()}_${process.hrtime.bigint()}_${browserType}_${device}.png`;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    return { path: filePath, error: null };
  } catch (error) {
    return { path: null, error: (error as Error).message };
  }
}

export {
  captureScreenshot,
  SCREENSHOT_DIR,
  MAX_INLINE_SCREENSHOT_BYTES,
  MAX_INLINE_SCREENSHOT_PIXELS,
  MAX_INLINE_SCREENSHOT_HEIGHT,
};