'use strict';
const assert = require('node:assert/strict');
const {
    gerarHeaderWidget, montarWidgetHtml, gerarHeroDestaqueMosaico,
    gerarHeroDestaqueCard, gerarNavWidget,
} = require('./widgets');

const header = gerarHeaderWidget();
assert.match(header, /<b:widget id='Header1'[^>]*type='Header'/);
assert.match(header, /<data:blog\.title\/>/);
assert.match(header, /expr:href='data:blog\.homepageUrl'/);

assert.equal(montarWidgetHtml('HTML3', 'Vazio', ''), '');
assert.equal(montarWidgetHtml('HTML3', 'Vazio', ' \t\n '), '');
const html = montarWidgetHtml('HTML89', 'Meu Widget', '  <div id="meu">Olá</div>  ');
assert.match(html, /<b:widget id='HTML89'[^>]*title='Meu Widget'[^>]*type='HTML'/);
assert.match(html, /<b:widget-setting name='content'><!\[CDATA\[<div id="meu">Olá<\/div>\]\]><\/b:widget-setting>/);
assert.ok(!html.includes('<b:includable'), 'HTML é gadget nativo e não usa includable customizado');

const fechamento = montarWidgetHtml('HTML90', 'CDATA', 'a]]>b]]>c');
assert.equal((fechamento.match(/\]\]\]\]><!\[CDATA\[>/g) || []).length, 2, 'CDATAs perigosos devem ser divididos');
assert.ok(fechamento.includes('a]]]]><![CDATA[>b]]]]><![CDATA[>c'));

for (const [fn, classe, titulo, mostRecent] of [
    [gerarHeroDestaqueMosaico, 'hero-mosaic', 'Destaque mosaico', true],
    [gerarHeroDestaqueCard, 'hero-destaque-card', 'Destaque cartão', true]
]) {
    const xml = fn(titulo, 'hero-real');
    assert.match(xml, /<b:widget id='FeaturedPost1'[^>]*type='FeaturedPost'/);
    assert.ok(xml.includes("title='"+titulo+"'"));
    assert.ok(xml.includes("id='hero-real'"));
    assert.ok(xml.includes("data:postFirstImage"));
    assert.ok(xml.includes("data:postUrl"));
    assert.ok(xml.includes("data:postTitle"));
    assert.ok(xml.includes("name='useMostRecentPost'>true"));
    assert.ok(xml.includes(classe));
    assert.equal(xml.includes('[TITULO]'), false, 'sem placeholders falsos');
}
const card = gerarHeroDestaqueCard('Destaque', 'custom');
assert.ok(card.includes("name='showSnippet'>true"));
assert.ok(card.includes('data:postSnippet'));
const mosaico = gerarHeroDestaqueMosaico('Destaque', 'custom');
assert.ok(mosaico.includes("name='showSnippet'>false"));
assert.ok(!mosaico.includes('data:postSnippet'));

const nav = gerarNavWidget();
const mobile = gerarNavWidget('PageList2');
assert.ok(nav.includes("id='PageList1'"));
assert.ok(mobile.includes("id='PageList2'"));
assert.ok(nav.includes('data:pages') && mobile.includes('data:pages'));
assert.notEqual(nav, mobile);
console.log('✅ widgets Blogger: Header, HTML/CDATA, FeaturedPost autoral e navegação desktop/mobile.');
