'use strict';

const assert = require('node:assert/strict');
const { injetarSlotsXml, construirTraceCompilacao } = require('./compileStages');
const { SLOT_MANIFEST } = require('./slotManifest');
const { detectarOrfaos } = require('./orphans');
const { construirGrafoCampos } = require('./fieldGraph');

const resolved = {
    THEME_COLOR: '#112233', SEO_MODULE: '<meta/>', FONT_MODULE: '<link/>',
    DYNAMIC_CSS: 'body{}', GRID_CLASS: 'sl-grid-revista', LAZY_LOAD_TOGGLE: "loading='lazy'",
    NICHO_CSS: '.nicho{}', NICHO_JS: '<script>[[PLACEHOLDER_IMG]]</script>',
    NICHO_HERO: '<header>[[PLACEHOLDER_IMG]]</header>',
    NICHO_WIDGETS_HTML: '<aside>[[PLACEHOLDER_IMG]]</aside>',
    NICHO_EXTRA_SECTIONS: '<section>[[PLACEHOLDER_IMG]]</section>',
    PLACEHOLDER_IMG: 'data:image/svg+xml;utf8,ok', BREAKING_NEWS_BAR: '<div>novidades</div>',
    BODY_LAYOUT_CLASS: 'sl-footer-simple', FOOTER_NEWSLETTER: '<form/>',
    HEADER_WIDGET: '<h1/>', NAV_WIDGET: '<nav/>', MOBILE_NAV_WIDGET: '<nav id="mobile"/>',
    ICON_AUTHOR: 'fa-user',
};

// Os 19 tokens do estágio de injeção (todos os fixos, sem módulos extras).
const base = [
    'THEME_COLOR', 'SEO_MODULE', 'FONT_MODULE', 'DYNAMIC_CSS', 'GRID_CLASS',
    'LAZY_LOAD_TOGGLE', 'NICHO_CSS', 'NICHO_JS', 'NICHO_HERO',
    'NICHO_WIDGETS_HTML', 'NICHO_EXTRA_SECTIONS', 'PLACEHOLDER_IMG',
    'BREAKING_NEWS_BAR', 'BODY_LAYOUT_CLASS', 'FOOTER_NEWSLETTER',
    'HEADER_WIDGET', 'NAV_WIDGET', 'MOBILE_NAV_WIDGET', 'ICON_AUTHOR',
].map(key => `[[${key}]]`).join('|');
const actual = injetarSlotsXml(base, resolved, {});
const placeholder = resolved.PLACEHOLDER_IMG;
const expected = [
    '#112233', '<meta/>', '<link/>', 'body{}', 'sl-grid-revista', "loading='lazy'",
    '\n<!-- DP:CSS:START -->\n.nicho{}\n<!-- DP:CSS:END -->\n',
    `<script>${placeholder}</script>`,
    `\n<!-- DP:HERO:START -->\n<header>${placeholder}</header>\n<!-- DP:HERO:END -->\n`,
    `<aside>${placeholder}</aside>`, `<section>${placeholder}</section>`, placeholder,
    '<div>novidades</div>', 'sl-footer-simple', '<form/>', '<h1/>',
    '<nav/>', '<nav id="mobile"/>', 'fa-user',
].join('|');
assert.equal(actual, expected, 'A injeção deve preservar cada byte de HTML, XML e CSS');

assert.equal(injetarSlotsXml('<p>sem tokens</p>', resolved, {}), '<p>sem tokens</p>');
assert.equal(injetarSlotsXml('[[NICHO_HERO]][[NICHO_CSS]]', {
    ...resolved, NICHO_HERO: '', NICHO_CSS: '',
}, {}), '', 'Não marcar heros ou CSS de nicho vazios');

// Ordem importa: módulo injetado antes da imagem é expandido;
// SEO já substituído não é executado novamente ao chegar no JS do nicho.
const order = injetarSlotsXml('[[CUSTOM]]|[[NICHO_JS]]', {
    ...resolved, NICHO_JS: '[[SEO_MODULE]]',
}, { '[[CUSTOM]]': '<b>[[PLACEHOLDER_IMG]]</b>' });
assert.equal(order, `<b>${placeholder}</b>|[[SEO_MODULE]]`);
assert.equal(detectarOrfaos(order), `<b>${placeholder}</b>| `);

const trace = construirTraceCompilacao({ THEME_COLOR: '🌐', NICHO_JS: '<a/>' });
assert.equal(trace.length, 38);
assert.deepEqual(trace.map(x => x.slot), SLOT_MANIFEST.map(x => x.slot));
assert.equal(trace[0].valueBytes, 4, 'UTF-8 e não UTF-16');
assert.equal(trace[0].active, true);
assert.equal(trace[1].active, false);
assert.equal(trace.find(x => x.slot === 'NICHO_JS').valueBytes, 4);
for (let i = 0; i < trace.length; i++) {
    assert.strictEqual(trace[i].sources, SLOT_MANIFEST[i].sources, 'Não clonar sources');
    assert.equal(trace[i].type, SLOT_MANIFEST[i].type);
}
const graph = construirGrafoCampos(trace);
assert.strictEqual(graph.nos, trace);
assert.deepEqual(graph.campoParaSlots.get('typography'), ['FONT_MODULE', 'DYNAMIC_CSS']);
assert.deepEqual(graph.campoParaSlots.get('nichoTema'), [
    'NICHO_CSS', 'NICHO_JS', 'NICHO_HERO', 'NICHO_WIDGETS_HTML', 'ICON_AUTHOR',
]);
console.log('✅ Paridade de injeção DNA, marcadores DP, UTF-8 e trace: OK');
