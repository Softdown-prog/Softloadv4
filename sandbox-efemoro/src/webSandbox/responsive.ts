import type { Page } from "playwright";

export interface ResponsiveWarning { message: string }
export interface ResponsiveAuditResult { horizontalOverflow: boolean; viewportWarnings: ResponsiveWarning[] }

/**
 * Detecta overflow horizontal e possíveis problemas de viewport.
 * @param {import('playwright').Page} page
 * @returns {Promise<{horizontalOverflow: boolean, viewportWarnings: object[]}>}
 */
async function detectResponsiveIssues(page: Page): Promise<ResponsiveAuditResult> {
  const result: ResponsiveAuditResult = {
    horizontalOverflow: false,
    viewportWarnings: [],
  };

  try {
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const viewportWidth = window.innerWidth;
      const scrollWidth = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0);
      const hasOverflow = scrollWidth > viewportWidth + 1; // tolerância de 1px

      const viewportMeta = document.querySelector('meta[name="viewport"]');
      const hasViewportMeta = !!viewportMeta;
      const viewportContent = viewportMeta ? (viewportMeta as HTMLMetaElement).content : "";

      return {
        hasOverflow,
        scrollWidth,
        viewportWidth,
        hasViewportMeta,
        viewportContent,
      };
    });

    result.horizontalOverflow = metrics.hasOverflow;
    if (metrics.hasOverflow) {
      result.viewportWarnings.push({
        message: `Horizontal overflow detected: scrollWidth=${metrics.scrollWidth} > viewportWidth=${metrics.viewportWidth}`,
      });
    }
    if (!metrics.hasViewportMeta) {
      result.viewportWarnings.push({
        message: 'Missing <meta name="viewport"> tag',
      });
    } else if (!/width=device-width/.test(metrics.viewportContent)) {
      result.viewportWarnings.push({
        message: "Viewport meta does not contain width=device-width",
      });
    }
  } catch (error) {
    result.viewportWarnings.push({
      message: "Responsive check failed: " + (error as Error).message,
    });
  }

  return result;
}

export { detectResponsiveIssues };
