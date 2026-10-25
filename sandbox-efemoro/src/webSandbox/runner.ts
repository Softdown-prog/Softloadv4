import { validateOptions } from "./security.js";
import type { WebSandboxInput } from "./security.js";
import type { Browser, BrowserContext, Page } from "playwright";
import type { Viewport } from "./devices.js";
import type { CapturedConsoleEntry } from "./console.js";
import type { FailedWebRequest, BlockedWebRequest } from "./network.js";
import type { ResponsiveAuditResult } from "./responsive.js";
import type { AccessibilityAuditResult } from "./accessibility.js";
import type { InlinePng, ScreenshotDelivery, ScreenshotMode } from "./screenshots.js";

export interface SandboxRunResult {
  success: boolean;
  browser: string | null;
  device: string | null;
  viewport: Viewport | null;
  url: string | null;
  duration: number;
  console: { errors: CapturedConsoleEntry[]; warnings: CapturedConsoleEntry[] };
  network: { failedRequests: FailedWebRequest[] };
  responsive: ResponsiveAuditResult;
  accessibility: AccessibilityAuditResult;
  screenshotPath: string | null;
  screenshot: InlinePng | null;
  errors: Array<{ message: string; stack?: string }>;
  security: { blockedRequests: BlockedWebRequest[] };
}
import { getDeviceConfig } from "./devices.js";
import { launchBrowser } from "./browser.js";
import { captureScreenshot } from "./screenshots.js";
import { attachConsoleListeners } from "./console.js";
import { setupNetworkPolicy } from "./network.js";
import { runAccessibilityAudit } from "./accessibility.js";
import { detectResponsiveIssues } from "./responsive.js";

const MAX_LOGGED_ITEMS = 100;

// Tempo máximo de espera por "rede ociosa" antes de seguir mesmo
// assim -- substitui o `waitForTimeout(2000)` fixo do documento
// original. Uma espera fixa é curta demais para apps pesadas e
// desperdiça tempo em apps leves; esperar por uma condição real
// (rede ociosa), com um teto curto, se adapta ao caso real sem travar
// indefinidamente em apps com polling/websockets que nunca ficam
// ociosas.
const NETWORK_IDLE_WAIT_MS = 3000;

/**
 * Executa a análise web sandbox.
 * @param {object} options
 * @param {string} options.url
 * @param {string} [options.browser='chromium']
 * @param {string} [options.device='desktop']
 * @param {object} [options.viewport]
 * @param {boolean} [options.screenshot=true]
 * @param {"path"|"inline"} [options.screenshotDelivery="path"]
 * @param {boolean} [options.accessibility=true]
 * @param {string[]} [options.allowedHosts]
 * @param {number} [options.timeout=30000]
 * @returns {Promise<object>} Resultado estruturado.
 *
 * Nota de segurança: nenhum campo de `options` controla QUAL BINÁRIO
 * de navegador é executado -- isso é deliberado, ver browser.js
 * (CHROMIUM_EXECUTABLE_PATH/WEBKIT_EXECUTABLE_PATH, lidos só de
 * variável de ambiente). `options` chega aqui a partir do corpo de
 * uma requisição HTTP em produção (ver server.js); aceitar um
 * caminho de executável vindo de lá seria execução de código
 * arbitrário no container.
 */
async function runWebSandbox(options: WebSandboxInput): Promise<SandboxRunResult> {
  const startTime = Date.now();
  const result: SandboxRunResult = {
    success: false,
    browser: null,
    device: null,
    viewport: null,
    url: null,
    duration: 0,
    console: { errors: [], warnings: [] },
    network: { failedRequests: [] },
    responsive: { horizontalOverflow: false, viewportWarnings: [] },
    accessibility: { violations: [] },
    screenshotPath: null,
    screenshot: null,
    errors: [],
    security: { blockedRequests: [] },
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let screenshotFailed = false;

  try {
    const validated = validateOptions(options);
    const {
      url,
      browserType,
      device,
      viewport,
      screenshot,
      screenshotDelivery,
      screenshotMode,
      accessibility,
      allowedHosts,
      timeout,
    } = validated;
    result.url = url;
    result.browser = browserType;
    result.device = device;

    const deviceConfig = getDeviceConfig(device, viewport);
    result.viewport = deviceConfig.viewport;

    browser = await launchBrowser(browserType as "chromium" | "webkit", { timeout });

    context = await browser.newContext({
      viewport: deviceConfig.viewport,
      userAgent: deviceConfig.userAgent,
      locale: deviceConfig.locale,
      timezoneId: deviceConfig.timezoneId,
      permissions: [],
      ignoreHTTPSErrors: false,
      extraHTTPHeaders: {},
    });

    const targetUrl = new URL(url);
    const networkPolicy = await setupNetworkPolicy(context, allowedHosts, targetUrl);

    page = await context.newPage();
    attachConsoleListeners(page, result);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout });

    // Espera best-effort por rede ociosa, com teto curto -- nunca
    // deixa a auditoria travada em apps que fazem polling contínuo.
    await page
      .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_WAIT_MS })
      .catch(() => {});

    if (screenshot) {
      const screenshotResult = await captureScreenshot(page, browserType, device, {
        delivery: screenshotDelivery as ScreenshotDelivery,
        mode: screenshotMode as ScreenshotMode,
      });
      result.screenshotPath = screenshotResult.path;
      result.screenshot = screenshotResult.screenshot || null;
      if (screenshotResult.error) {
        screenshotFailed = true;
        result.errors.push({ message: `Screenshot failed: ${screenshotResult.error}` });
      }
    }

    result.responsive = await detectResponsiveIssues(page);

    if (accessibility) {
      result.accessibility = await runAccessibilityAudit(page);
    }

    result.console.errors = result.console.errors.slice(0, MAX_LOGGED_ITEMS);
    result.console.warnings = result.console.warnings.slice(0, MAX_LOGGED_ITEMS);
    result.network.failedRequests = networkPolicy.failedRequests.slice(0, MAX_LOGGED_ITEMS);
    result.security.blockedRequests = networkPolicy.blockedRequests.slice(0, MAX_LOGGED_ITEMS);

    // Se o solicitante pediu um screenshot e ele não chegou, não
    // reportar auditoria completa como sucesso silencioso.
    result.success = !screenshotFailed;
  } catch (error) {
    result.errors.push({
      message: (error as Error).message,
      stack: (error as Error).stack?.split("\n").slice(0, 5).join("\n"),
    });
    result.success = false;
  } finally {
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (closeError) {
      result.errors.push({ message: "Error closing resources: " + (closeError as Error).message });
    }
    result.duration = Date.now() - startTime;
  }

  return result;
}

export { runWebSandbox };
