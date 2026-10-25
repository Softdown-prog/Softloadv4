/**
 * Preview visual do Blogger (mock de posts/widgets, nao uma instalacao real).
 * Compila XML e registra erros de pagina em desktop e mobile.
 */
export interface PreviewOptions {
  outDir?: string;
  siteName?: string;
}
export interface PreviewReport {
  nicho: string;
  htmlPath: string;
  screenshots: Record<string, string>;
  erros: string[];
}
interface Viewport { width: number; height: number }
interface PreviewPage {
  on(event: 'pageerror', handler: (err: { message: string }) => void): void;
  goto(url: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<unknown>;
  screenshot(options: { path: string; fullPage: true }): Promise<unknown>;
  close(): Promise<unknown>;
}
interface PreviewBrowser {
  newPage(options: { viewport: Viewport }): Promise<PreviewPage>;
  close(): Promise<unknown>;
}
interface BrowserDriver { launch(): Promise<PreviewBrowser> }
interface Filesystem {
  mkdirSync(directory: string, options: { recursive: true }): void;
  writeFileSync(file: string, contents: string, encoding: 'utf-8'): void;
}
interface Paths {
  join(...parts: string[]): string;
}
interface ProcessApi { argv: string[]; exit(code: number): never }
declare const __dirname: string;
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: ProcessApi;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('fs') as Filesystem;
const path = require('path') as Paths;
const { chromium } = require('playwright') as { chromium: BrowserDriver };
const { executarCompilacao } = require('../../src/core/compilerWorker') as {
  executarCompilacao(options: { siteName: string; nichoTema: string; colorPreset: 'tech-blue' }): { xmlFinal: string };
};
const { parseBloggerXMLToHTML } = require('../../src/lib/bloggerPreviewRenderer') as {
  parseBloggerXMLToHTML(xml: string, siteName: string): string;
};

const VIEWPORTS: Readonly<Record<'desktop' | 'mobile', Viewport>> = {
  desktop: { width: 1400, height: 1000 },
  mobile: { width: 390, height: 844 },
};

/** Escrita local de preview sem requisicoes externas nos testes. */
export async function renderPreview(nicho: string, { outDir, siteName }: PreviewOptions = {}): Promise<PreviewReport> {
  const site = siteName || 'Preview';
  const { xmlFinal } = executarCompilacao({ siteName: site, nichoTema: nicho, colorPreset: 'tech-blue' });
  const html = parseBloggerXMLToHTML(xmlFinal, site);

  const dir = outDir || path.join(__dirname, '..', '..', '.scratch', 'visual', nicho);
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'preview.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');

  const browser = await chromium.launch();
  const relatorio: PreviewReport = { nicho, htmlPath, screenshots: {}, erros: [] };

  try {
    for (const [nomeViewport, viewport] of Object.entries(VIEWPORTS)) {
      const page = await browser.newPage({ viewport });
      try {
        page.on('pageerror', err => relatorio.erros.push(`[${nomeViewport}] ${err.message}`));
        await page.goto('file://' + htmlPath);
        await page.waitForTimeout(800);
        const screenshotPath = path.join(dir, `${nomeViewport}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        relatorio.screenshots[nomeViewport] = screenshotPath;
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return relatorio;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const nicho = args.find(a => !a.startsWith('--'));
  if (!nicho) {
    console.error('Uso: node scripts/visual/renderPreview.js <nicho> [--site="Nome"]');
    process.exit(1);
  }
  const siteArg = args.find(a => a.startsWith('--site='));
  const siteName = siteArg ? siteArg.slice('--site='.length) : undefined;

  renderPreview(nicho, { siteName }).then(relatorio => {
    console.log(`\n=== ${relatorio.nicho} ===`);
    console.log('HTML:', relatorio.htmlPath);
    Object.entries(relatorio.screenshots).forEach(([vp, p]) => console.log(`Screenshot (${vp}):`, p));
    if (relatorio.erros.length) {
      console.log('\n⚠️  Erros de console/JS capturados (podem incluir falso-positivo de rede — ver limitações no topo do arquivo):');
      relatorio.erros.forEach(e => console.log('  ' + e));
    } else {
      console.log('\n✅ Nenhum erro de console/JS capturado.');
    }
  }).catch(err => {
    console.error('Falha ao renderizar preview:', err);
    process.exit(1);
  });
}
