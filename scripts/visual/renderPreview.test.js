'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

/** Isola navegador e compilador sem carregar Chromium ou tocar em servicos externos. */
function makePreviewHarness({ failedViewport = null } = {}) {
    const calls = [];
    const mod = { exports: {} };
    const requireMock = (name) => {
        if (name === 'fs') return fs;
        if (name === 'path') return path;
        if (name === 'playwright') return {
            chromium: { async launch() {
                calls.push(['launch']);
                return {
                    async newPage({ viewport }) {
                        const label = viewport.width > 1000 ? 'desktop' : 'mobile';
                        calls.push(['newPage', label, viewport.width, viewport.height]);
                        return {
                            on(name, callback) { assert.equal(name, 'pageerror'); callback({ message: 'simulated console error' }); },
                            async goto(url) { calls.push(['goto', label, url]); },
                            async waitForTimeout(ms) { assert.equal(ms, 800); },
                            async screenshot(options) {
                                calls.push(['screenshot', label, options.path, options.fullPage]);
                                if (failedViewport === label) throw new Error('screenshot failed');
                            },
                            async close() { calls.push(['page.close', label]); },
                        };
                    },
                    async close() { calls.push(['browser.close']); },
                };
            } },
        };
        if (name === '../../src/core/compilerWorker') return {
            executarCompilacao(options) {
                calls.push(['compile', options]);
                return { xmlFinal: '<xml/>' };
            },
        };
        if (name === '../../src/lib/bloggerPreviewRenderer') return {
            parseBloggerXMLToHTML(xml, siteName) {
                assert.equal(xml, '<xml/>');
                return '<!doctype html><title>' + siteName + '</title>';
            },
        };
        throw new Error('Import inesperado: ' + name);
    };
    requireMock.main = undefined;
    const filename = path.join(__dirname, 'renderPreview.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module: mod,
        exports: mod.exports,
        require: requireMock,
        __dirname: __dirname,
        console,
    }, { filename });
    return { renderPreview: mod.exports.renderPreview, calls };
}

test('preview Blogger: desktop/mobile, HTML local e relatorio de erros sem Chromium', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-preview-'));
    try {
        const { renderPreview, calls } = makePreviewHarness();
        const report = await renderPreview('portfolio-minimalista', { outDir: dir, siteName: 'Site Teste' });
        assert.equal(report.nicho, 'portfolio-minimalista');
        assert.equal(fs.readFileSync(report.htmlPath, 'utf8'), '<!doctype html><title>Site Teste</title>');
        assert.deepEqual(Object.keys(report.screenshots).sort(), ['desktop', 'mobile']);
        assert.deepEqual(Array.from(report.erros), ['[desktop] simulated console error', '[mobile] simulated console error']);
        assert.equal(calls.filter(c => c[0] === 'page.close').length, 2);
        assert.equal(calls.filter(c => c[0] === 'browser.close').length, 1);
        assert.equal(calls.filter(c => c[0] === 'screenshot').length, 2);
        assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c => c[0] === 'compile')[1])), {
            siteName: 'Site Teste', nichoTema: 'portfolio-minimalista', colorPreset: 'tech-blue',
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('preview Blogger: fecha pagina e navegador quando screenshot falha', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-preview-'));
    try {
        const { renderPreview, calls } = makePreviewHarness({ failedViewport: 'mobile' });
        await assert.rejects(renderPreview('biolink-social', { outDir: dir }), /screenshot failed/);
        assert.equal(calls.filter(c => c[0] === 'page.close').length, 2);
        assert.equal(calls.filter(c => c[0] === 'browser.close').length, 1);
        assert.ok(calls.some(c => c[0] === 'compile' && c[1].siteName === 'Preview'));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
