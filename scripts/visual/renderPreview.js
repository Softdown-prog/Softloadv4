'use strict';

// ============================================================
// RENDER PREVIEW — inspeção visual reutilizável (estágio "Refinamento"
// da migração de dossiê por nicho).
//
// Compila um nicho de verdade (executarCompilacao), converte o XML pra
// HTML de preview (bloggerPreviewRenderer.js — o mesmo usado no
// dashboard) e tira screenshots desktop + mobile via Playwright,
// registrando também qualquer erro de console/JS.
//
// LIMITAÇÃO CONHECIDA (herdada do bloggerPreviewRenderer.js, não
// escondida): o preview não interpreta b:if/b:loop de verdade (regex
// fixas pra padrões conhecidos), mocka só 3 posts fixos, não renderiza
// settings de widgets custom (ContactForm/PopularPosts/Label/PageList).
// Serve pra validar CSS/hero/widgets ESTÁTICOS do dossiê — não
// comportamento dependente de dado real do Blogger (feeds, comentários).
//
// Uso: node scripts/visual/renderPreview.js <nicho> [--out=dir] [--site="Nome do Site"]
// ============================================================

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { executarCompilacao } = require('../../src/core/compilerWorker');
const { parseBloggerXMLToHTML } = require('../../src/lib/bloggerPreviewRenderer');

const VIEWPORTS = {
    desktop: { width: 1400, height: 1000 },
    mobile:  { width: 390,  height: 844  },
};

async function renderPreview(nicho, { outDir, siteName } = {}) {
    const site = siteName || 'Preview';
    const { xmlFinal } = executarCompilacao({ siteName: site, nichoTema: nicho, colorPreset: 'tech-blue' });
    const html = parseBloggerXMLToHTML(xmlFinal, site);

    const dir = outDir || path.join(__dirname, '..', '..', '.scratch', 'visual', nicho);
    fs.mkdirSync(dir, { recursive: true });
    const htmlPath = path.join(dir, 'preview.html');
    fs.writeFileSync(htmlPath, html, 'utf-8');

    const browser = await chromium.launch();
    const relatorio = { nicho, htmlPath, screenshots: {}, erros: [] };

    for (const [nomeViewport, viewport] of Object.entries(VIEWPORTS)) {
        const page = await browser.newPage({ viewport });
        page.on('pageerror', err => relatorio.erros.push(`[${nomeViewport}] ${err.message}`));
        await page.goto('file://' + htmlPath);
        await page.waitForTimeout(800);
        const screenshotPath = path.join(dir, `${nomeViewport}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        relatorio.screenshots[nomeViewport] = screenshotPath;
        await page.close();
    }

    await browser.close();
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

module.exports = { renderPreview };
