import type { Page } from "playwright";

export interface AccessibilityViolation { id: string; impact: string | null; description: string; help: string; nodes: number; wcag: string[] }
export interface AccessibilityAuditResult { violations: AccessibilityViolation[]; error?: string }
interface RawAxeViolation { id: string; impact: string | null; description: string; help: string; nodes: unknown[]; tags: string[] }
declare global {
  interface Window {
    axe: { run(document: Document, options: { runOnly: { type: string; values: string[] } }): Promise<{ violations: RawAxeViolation[] }> };
  }
}

import fs from "node:fs";

const AXE_TIMEOUT_MS = 15000;

/**
 * Executa auditoria de acessibilidade usando axe-core, com um timeout
 * dedicado -- separado do timeout de navegação. Sem isso, uma página
 * adversarial ou só pesada poderia travar `page.evaluate(axe.run)`
 * indefinidamente (ex: um loop de microtask, um Proxy que intercepta
 * chamadas do axe-core), pendurando a execução inteira além do
 * timeout de `page.goto`.
 * @param {import('playwright').Page} page
 * @returns {Promise<{violations: object[], error?: string}>}
 */
async function runAccessibilityAudit(page: Page): Promise<AccessibilityAuditResult> {
  try {
    // import.meta.resolve segue a resolução real de node_modules
    // (equivalente ESM do antigo require.resolve), em vez de assumir
    // um caminho relativo fixo que quebraria se a estrutura de
    // pastas ou a estratégia de hoisting do npm mudar.
    const axePath = import.meta.resolve("axe-core/axe.min.js");
    const axeSource = fs.readFileSync(new URL(axePath), "utf8");

    await page.addScriptTag({ content: axeSource });

    const axeResults = await withTimeout(
      page.evaluate(async () => {
        const result = await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
        });
        return result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          help: v.help,
          nodes: v.nodes.length,
          wcag: v.tags.filter((t) => t.startsWith("wcag")),
        }));
      }),
      AXE_TIMEOUT_MS,
      "Accessibility audit timed out",
    );

    return { violations: axeResults };
  } catch (error) {
    return { violations: [], error: (error as Error).message };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export { runAccessibilityAudit, AXE_TIMEOUT_MS };
