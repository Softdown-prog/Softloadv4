'use strict';

// Snapshots SHA-256 calculados a partir das saídas dos módulos JS legados
// ANTES da migração. Uma alteração de 1 byte no XML/CSS falha o teste.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { gerarFontModule } = require('./fonts');
const { gerarSeoModule } = require('./seo');
const { gerarLayoutCss, resolverLayoutClasses, gerarFooterNewsletter } = require('./layout');

function fingerprint(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const typography = [
    { fontUrl: 'https://fonts.googleapis.com/css2?family=Roboto&display=swap' },
    { fontUrl: '' },
    { fontUrl: '&amp;&' },
    { fontUrl: null },
];
const fonts = typography.map(item => gerarFontModule(item));
assert.equal(fingerprint(fonts), '0486bddee8e60ecd0cf24ccd0e4fdaed9c5002ad125a5c1898f10767697bbc6d');
assert.ok(fonts[0].includes('Roboto&amp;display=swap'));

const names = ['x', 'A & B <Tech>', 'Título 💻', '" and \\'];
const descriptions = [undefined, '', 'texto', 'Somos & top <top> " x', 'x'.repeat(180)];
const seo = names.flatMap(name => descriptions.map(description => gerarSeoModule(name, description)));
assert.equal(fingerprint(seo), '61b3cfb91d2220ebe318ed4895a8aaf767fd5a1f32af53da0dd8aba41a1cb8c2');
assert.ok(seo[5].includes('"name": "A \\u0026 B \\u003cTech\\u003e"'));
assert.ok(seo[0].includes("<meta content='x' name='description'/>"));
assert.ok(seo[4].includes("<meta content='" + 'x'.repeat(160) + "' name='description'/>"));

const layouts = [];
for (const footerStyle of [undefined, 'simple-copyright', 'newsletter-integrated', 'normal']) {
    for (const sidebarPosition of [undefined, 'left', 'right', 'none']) {
        layouts.push({ footerStyle, sidebarPosition });
    }
}
const layoutOutputs = layouts.map(options => [gerarLayoutCss(options), resolverLayoutClasses(options)]);
assert.equal(fingerprint(layoutOutputs), '41b4655fdea62e9fe2d58d05407cccef274115ba3d926c078976d150f2344a81');
assert.equal(gerarLayoutCss({ footerStyle: 'normal', sidebarPosition: 'right' }), '');
assert.equal(resolverLayoutClasses({ footerStyle: 'simple-copyright', sidebarPosition: 'left' }), 'sl-sidebar-left sl-footer-simple');
const newsletter = gerarFooterNewsletter();
assert.equal(fingerprint(newsletter), 'e81835a609f565b4cb36f2267608135bde76fbeeacbd284b3e578afa6adf1ed5');
assert.ok(newsletter.includes("type='email'/>"));

console.log('✅ Paridade byte a byte: fontes, SEO, layout e newsletter (contratos JS legados).');
