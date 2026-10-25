'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

function harness({ brokenMobile = false } = {}) {
    const calls = [];
    let pageNumber = 0;
    let closeCount = 0;
    const fakeFs = {
        ...fs,
        existsSync(file) {
            if (file.endsWith('/exemplos/fake-theme.xml')) return true;
            if (file.endsWith('/exemplos/missing-theme.xml')) return false;
            return fs.existsSync(file);
        },
        readFileSync(file, encoding) {
            if (file.endsWith('/exemplos/fake-theme.xml')) return '<xml>author</xml>';
            return fs.readFileSync(file, encoding);
        },
    };
    const browser = {
        async newPage({ viewport }) {
            const index = pageNumber++;
            const label = viewport.width === 390 ? 'mobile' : 'desktop';
            const phase = index % 2 === 0 ? 'autoral' : 'gerado';
            calls.push(['newPage', label, phase]);
            return {
                on(event, handler) { assert.equal(event, 'pageerror'); handler(new Error('script error')); },
                async goto(url, options) {
                    assert.equal(options.waitUntil, 'load');
                    assert.equal(options.timeout, 30000);
                    assert.ok(url.startsWith('file://'));
                    if (brokenMobile && label === 'mobile' && phase === 'gerado') throw Error('simulated navigation failure');
                },
                async waitForTimeout(ms) { assert.equal(ms, 900); },
                async evaluate(fn) {
                    assert.equal(typeof fn, 'function');
                    return {
                        viewport: viewport.width,
                        scrollWidth: viewport.width + (phase === 'gerado' ? 22 : 0),
                        scrollHeight: 1500, visibleElements: 13, headings: 4, links: 3, images: 2,
                    };
                },
                async screenshot({ path: target, fullPage }) {
                    assert.equal(fullPage, true);
                    fs.writeFileSync(target, 'png mock');
                },
                async close() { calls.push(['page.close', label, phase]); },
            };
        },
        async close() { closeCount++; },
    };
    const mocked = (name) => {
        if (name === 'node:fs') return fakeFs;
        if (name === 'node:path') return path;
        if (name === 'playwright') return { chromium: { launch: async ({ headless }) => { assert.equal(headless, true); return browser; } } };
        if (name === '../../src/core/compilerWorker') return { executarCompilacao: options => {
            assert.deepEqual(JSON.parse(JSON.stringify(options)), { siteName: 'Softload QA Preview', nichoTema: 'fake-theme' });
            return { xmlFinal: '<xml>generated</xml>' };
        }};
        if (name === '../../src/lib/bloggerPreviewRenderer') return { parseBloggerXMLToHTML: (xml, name) => '<html>' + name + ':' + xml + '</html>' };
        throw Error('Unexpected import ' + name);
    };
    mocked.main = {};
    const moduleObject = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'compareTemplates.js'), 'utf8'), {
        require: mocked, module: moduleObject, exports: moduleObject.exports,
        __dirname: __dirname, console: { log() {}, error() {} }, process: { argv: [] },
    });
    return { ...moduleObject.exports, calls, getCloseCount: () => closeCount };
}

test('comparação visual gera auditoria mock e pares desktop/mobile sem executar Chromium', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-compare-'));
    try {
        const h = harness();
        const report = await h.run({ niches: ['fake-theme', 'missing-theme'], outDir: dir });
        assert.equal(report.kind, 'blogger-mock-preview-not-live');
        assert.equal(report.niches.length, 2);
        assert.equal(report.niches[1].skipped, 'sem arquivo de referência autoral');
        for (const label of ['desktop', 'mobile']) {
            assert.equal(report.niches[0].views[label].originalOverflowPx, 0);
            assert.equal(report.niches[0].views[label].generatedOverflowPx, 22);
            assert.deepEqual(Array.from(report.niches[0].views[label].original.errors), ['script error']);
        }
        assert.equal(h.calls.filter(x => x[0] === 'page.close').length, 4);
        assert.equal(h.getCloseCount(), 1);
        assert.equal(report.warnings.length, 0);
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'preview-audit.json'), 'utf8')).kind, report.kind);
        const comparison = fs.readFileSync(path.join(dir, 'comparison.html'), 'utf8');
        assert.match(comparison, /NÃO representa a renderização final do Blogger/);
        assert.match(comparison, /fake-theme\/gerado-mobile.png/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('erro de navegação fica isolado por nicho e fecha abas/browser', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-compare-'));
    try {
        const h = harness({ brokenMobile: true });
        const report = await h.run({ niches: ['fake-theme', 'missing-theme'], outDir: dir });
        assert.equal(report.niches.length, 1);
        assert.equal(report.niches[0].skipped, 'sem arquivo de referência autoral');
        assert.deepEqual(JSON.parse(JSON.stringify(report.warnings)), [{ nicho: 'fake-theme', error: 'simulated navigation failure' }]);
        assert.equal(h.calls.filter(x => x[0] === 'page.close').length, 4);
        assert.equal(h.getCloseCount(), 1);
        assert.ok(fs.existsSync(path.join(dir, 'comparison.html')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
