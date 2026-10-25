/**
 * Comparador de renderização MOCKADA do Blogger entre o XML autoral e o
 * compilado. Os screenshots não validam um tema instalado no Blogger real.
 *
 * node scripts/visual/compareTemplates.js --niches=biolink-social,pop-retro-pixel
 */
export interface TemplateViewport { width: number; height: number }
export interface PageMetrics {
    viewport: number;
    scrollWidth: number;
    scrollHeight: number;
    visibleElements: number;
    headings: number;
    links: number;
    images: number;
}
export interface RenderResult { metrics: PageMetrics; errors: string[] }
export interface ComparisonView {
    original: RenderResult;
    generated: RenderResult;
    originalOverflowPx: number;
    generatedOverflowPx: number;
}
export interface NicheComparison {
    nicho: string;
    skipped?: string;
    reference?: string;
    views?: Record<string, ComparisonView>;
}
export interface CompareReport {
    kind: 'blogger-mock-preview-not-live';
    createdAt: string;
    niches: NicheComparison[];
    warnings: Array<{ nicho: string; error: string }>;
}
export interface ComparisonPanel { nicho: string; view: string; original: string; generated: string }
interface PageBrowser {
    newPage(options: {viewport: TemplateViewport}): Promise<BrowserPage>;
    close(): Promise<void>;
}
interface BrowserPage {
    on(event: 'pageerror', callback: (error: Error) => void): void;
    goto(url: string, options: {waitUntil: 'load'; timeout: number}): Promise<void>;
    waitForTimeout(ms: number): Promise<void>;
    evaluate<T>(callback: () => T): Promise<T>;
    screenshot(options: {path: string; fullPage: true}): Promise<void>;
    close(): Promise<void>;
}
interface FileSystemApi {
    writeFileSync(file: string, contents: string, encoding?: string): void;
    existsSync(file: string): boolean;
    mkdirSync(dir: string, options: {recursive: true}): void;
    readFileSync(file: string, encoding: string): string;
}
interface PathApi {resolve(...parts: string[]): string; join(...parts: string[]): string}
interface BrowserPageElement {getBoundingClientRect(): {width: number; height: number}}
declare const document: {
    body: {scrollWidth: number; scrollHeight: number} | null;
    documentElement: {scrollWidth: number; scrollHeight: number};
    querySelectorAll(selector: string): BrowserPageElement[];
};
declare const innerWidth: number;
declare const __dirname: string;
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('node:fs') as FileSystemApi;
const path = require('node:path') as PathApi;
const { chromium } = require('playwright') as { chromium: {launch(options: {headless: true}): Promise<PageBrowser>} };
const { executarCompilacao } = require('../../src/core/compilerWorker') as {
    executarCompilacao(options: {siteName: string; nichoTema: string}): {xmlFinal: string};
};
const { parseBloggerXMLToHTML } = require('../../src/lib/bloggerPreviewRenderer') as {
    parseBloggerXMLToHTML(xml: string, siteName: string): string;
};

const ROOT = path.resolve(__dirname,'../..');
const VIEWS: Readonly<Record<'desktop' | 'mobile', TemplateViewport>> = {
    desktop:{width:1400,height:900},
    mobile:{width:390,height:844},
};

export function outputHtml(sections: readonly ComparisonPanel[]): string {
    const img = (p: string) => '<img loading="lazy" alt="Comparação de layout" src="'+p+'"/>';
    return '<!doctype html><html lang="pt-br"><head><meta charset="utf-8"/>'+
      '<meta name="viewport" content="width=device-width,initial-scale=1"/>'+
      '<title>Comparação Softload — autoral versus gerado</title>'+
      '<style>body{font:15px system-ui,sans-serif;background:#f4f6f9;color:#162033;padding:20px}'+
      'h1{font-size:22px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}'+
      '.pair>section{min-width:0}img{max-width:100%;height:auto;border:1px solid #999}'+
      '@media(max-width:720px){.pair{grid-template-columns:1fr}}'+
      '</style></head><body><h1>Softload — referência autoral × XML compilado</h1>'+
      '<p>Preview com posts simulados; NÃO representa a renderização final do Blogger.</p>'+
      sections.map(s=>'<h2>'+s.nicho+' / '+s.view+'</h2><div class="pair">'+
        '<section><h3>Autoral</h3>'+img(s.original)+'</section>'+
        '<section><h3>Gerado</h3>'+img(s.generated)+'</section></div>').join('')+
      '</body></html>';
}

async function renderPage(browser: PageBrowser,html: string,htmlPath: string,pngPath: string,viewport: TemplateViewport): Promise<RenderResult> {
    fs.writeFileSync(htmlPath,html,'utf8');
    const page=await browser.newPage({viewport});
    const errors: string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    try {
        await page.goto('file://'+htmlPath,{waitUntil:'load',timeout:30000});
        await page.waitForTimeout(900);
        const metrics=await page.evaluate(()=>{
            const body=document.body;
            const doc=document.documentElement;
            const nodes=[...document.querySelectorAll('body *')];
            const visible=nodes.filter(el=>el.getBoundingClientRect().width>0 &&
                el.getBoundingClientRect().height>0).length;
            return {
                viewport:innerWidth,
                scrollWidth:Math.max(doc.scrollWidth,body?.scrollWidth||0),
                scrollHeight:Math.max(doc.scrollHeight,body?.scrollHeight||0),
                visibleElements:visible,
                headings:document.querySelectorAll('h1,h2,h3').length,
                links:document.querySelectorAll('a').length,
                images:document.querySelectorAll('img').length
            };
        });
        await page.screenshot({path:pngPath,fullPage:true});
        return {metrics,errors};
    } finally {
        await page.close();
    }
}

async function compareNiche(browser: PageBrowser,nicho: string,outDir: string): Promise<NicheComparison> {
    const originalFile=path.join(ROOT,'exemplos',nicho+'.xml');
    if(!fs.existsSync(originalFile))return {nicho,skipped:'sem arquivo de referência autoral'};
    const themeDir=path.join(outDir,nicho);
    fs.mkdirSync(themeDir,{recursive:true});
    const original=fs.readFileSync(originalFile,'utf8');
    const generated=executarCompilacao({siteName:'Softload QA Preview',nichoTema:nicho}).xmlFinal;
    const htmlOrig=parseBloggerXMLToHTML(original,'Softload QA Preview');
    const htmlGen=parseBloggerXMLToHTML(generated,'Softload QA Preview');
    const views: Record<string,ComparisonView>={};
    for(const [view,viewport] of Object.entries(VIEWS)){
        const a=await renderPage(browser,htmlOrig,
            path.join(themeDir,'autoral-'+view+'.html'),
            path.join(themeDir,'autoral-'+view+'.png'),viewport);
        const b=await renderPage(browser,htmlGen,
            path.join(themeDir,'gerado-'+view+'.html'),
            path.join(themeDir,'gerado-'+view+'.png'),viewport);
        views[view]={original:a,generated:b,
            originalOverflowPx:Math.max(0,a.metrics.scrollWidth-viewport.width),
            generatedOverflowPx:Math.max(0,b.metrics.scrollWidth-viewport.width)};
    }
    return {nicho,reference:originalFile,views};
}

export async function run({niches,outDir}: {niches: string[]; outDir: string}): Promise<CompareReport> {
    const browser=await chromium.launch({headless:true});
    const report: CompareReport={kind:'blogger-mock-preview-not-live',createdAt:new Date().toISOString(),
        niches:[],warnings:[]};
    try {
        for(const nicho of niches){
            try {
                const result=await compareNiche(browser,nicho,outDir);
                report.niches.push(result);
                const v=result.views?.mobile;
                console.log('[VISUAL]',nicho,JSON.stringify({
                    skipped:result.skipped,
                    mobileOverflowReference:v?.originalOverflowPx,
                    mobileOverflowGenerated:v?.generatedOverflowPx,
                    errors:v?.generated.errors.length,
                }));
            }catch(e){
                report.warnings.push({nicho,error:(e as Error).message});
                console.error('[VISUAL] '+nicho+': '+(e as Error).message);
            }
        }
    } finally {await browser.close();}
    fs.mkdirSync(outDir,{recursive:true});
    fs.writeFileSync(path.join(outDir,'preview-audit.json'),JSON.stringify(report,null,2)+'\n');
    const panels: ComparisonPanel[]=[];
    for(const n of report.niches)if(n.views){
        for(const view of Object.keys(n.views))panels.push({
            nicho:n.nicho,view,
            original:n.nicho+'/autoral-'+view+'.png',
            generated:n.nicho+'/gerado-'+view+'.png'
        });
    }
    fs.writeFileSync(path.join(outDir,'comparison.html'),outputHtml(panels));
    return report;
}
if(require.main===module){
    const args=process.argv.slice(2);
    const flag=(name: string,defaultValue: string): string=>args.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)||defaultValue;
    const niches=flag('niches','biolink-social,pop-retro-pixel,viral-magazine')
        .split(',').map(x=>x.trim()).filter(Boolean);
    const outDir=path.resolve(flag('out','out/template-fidelity/visual'));
    run({niches,outDir}).then(result=>{
        if(result.warnings.length>0)process.exitCode=1;
    }).catch(e=>{console.error(e);process.exitCode=1;});
}
