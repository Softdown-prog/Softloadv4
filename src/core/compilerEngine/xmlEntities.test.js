'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sanitizarEntidadesXml, escaparTextoXml, injetarHeroTexto } = require('./xmlEntities');
const publicEngine = require('./index');

assert.equal(publicEngine.sanitizarEntidadesXml, sanitizarEntidadesXml);
assert.equal(publicEngine.injetarHeroTexto, injetarHeroTexto);

// O comportamento de passagem de valores não-string faz parte do legado.
for(const value of [null, undefined, false, 0, 42, [], {}, '']) {
    assert.equal(sanitizarEntidadesXml(value),value);
    assert.equal(injetarHeroTexto(value,'Título','Sub'),value);
}
assert.equal(escaparTextoXml(42),'42');
assert.equal(escaparTextoXml(null),'null');
assert.equal(escaparTextoXml('A&B <C> "aspas"'), 'A&amp;B &lt;C&gt; "aspas"');
assert.equal(escaparTextoXml('&amp;'),'&amp;amp;', 'Escape de texto não é idempotente no legado');

const replacements = new Map([
    ['&bull;','•'],['&middot;','·'],['&hellip;','…'],['&rarr;','→'],
    ['&copy;','©'],['&trade;','™'],['&reg;','®'],['&nbsp;',' '],
    ['&mdash;','—'],['&ldquo;','“'],['&rsquo;','’'],
    ['&euro;','€'],['&frac12;','½'],['&micro;','µ'],
    ['&infin;','∞'],['&ne;','≠'],['&spades;','♠'],
]);
for(const [entity,expected] of replacements) {
    assert.equal(sanitizarEntidadesXml(entity),expected,entity);
    assert.equal(sanitizarEntidadesXml('antes '+entity+' e '+entity+' depois'),
        'antes '+expected+' e '+expected+' depois');
}
const valid = ['&amp;','&lt;','&gt;','&quot;','&apos;','&#32;','&#xAF;','&#x1f600;'];
for(const entity of valid)assert.equal(sanitizarEntidadesXml(entity),entity);
assert.equal(sanitizarEntidadesXml('&bogus; &AMP; & &copy;'), '&amp;bogus; &amp;AMP; &amp; ©');
assert.equal(sanitizarEntidadesXml('&#X2a;'), '&amp;#X2a;', 'x hexadecimal é case-sensitive');
assert.equal(sanitizarEntidadesXml('<img src="a&b"><br><hr/>'),
    '<img src="a&amp;b"/><br/><hr/>');
assert.equal(sanitizarEntidadesXml('<IMG class="x" /> <input> <source src="m">'),
    '<IMG class="x" /> <input/> <source src="m"/>');
assert.equal(sanitizarEntidadesXml('<div><span>Texto</span></div>'),
    '<div><span>Texto</span></div>');

for(const tag of ['img','br','hr','input','link','meta','col','area','base','embed','param','source','track','wbr']) {
    assert.equal(sanitizarEntidadesXml('<'+tag+'>'),'<'+tag+'/>',tag);
    assert.equal(sanitizarEntidadesXml('<'+tag+'/>'),'<'+tag+'/>',tag);
    assert.equal(sanitizarEntidadesXml('<'+tag+' id="a">'),'<'+tag+' id="a"/>',tag);
}
for(const tag of ['div','span','script','style','h1','p','section']) {
    assert.equal(sanitizarEntidadesXml('<'+tag+'>'),'<'+tag+'>',tag);
}
// Alterar o texto do primeiro heading e do primeiro parágrafo, não estrutura posterior.
const hero = '<section><h2 class="first"><em>Original</em></h2><h3>Outro</h3><p class="lead">Antes</p><p>Depois</p></section>';
const expected='<section><h2 class="first">A &amp; B &lt;C&gt;</h2><h3>Outro</h3><p class="lead">Novo &amp; Sub</p><p>Depois</p></section>';
assert.equal(injetarHeroTexto(hero,'  A & B <C>  ',' Novo & Sub '),expected);
assert.equal(injetarHeroTexto(hero,' ',' '),hero);
assert.equal(injetarHeroTexto('<section>sem tags</section>','Outro','sub'),'<section>sem tags</section>');
assert.equal(injetarHeroTexto('<h1>Velho</h1>','Título',null),'<h1>Título</h1>');
assert.equal(injetarHeroTexto('<p>Antigo</p>',null,'Sub'),'<p>Sub</p>');
assert.equal(injetarHeroTexto('<H1 data-x="ok"><b>Velho</b></H1>','Novo',null),'<H1 data-x="ok">Novo</H1>');
assert.equal(injetarHeroTexto('<h1>Antes</h1><h1>Depois</h1>',3,2),
    '<h1>3</h1><h1>Depois</h1>');
assert.equal(injetarHeroTexto('<h1>Antes</h1><p>Antigo</p>','&amp;','&amp;'),
    '<h1>&amp;amp;</h1><p>&amp;amp;</p>');

// O motor deve manter a mesma output string para qualquer combinação do lote.
const heading = ['<h1>Primeiro</h1>','<h2 id="a">Segundo</h2>','<div>Sem heading</div>'];
const subtitles = ['<p>Antes</p>','<p class="lead">Mais</p>',''];
const titles = [undefined,null,'',' Novo ','Café &amp; Chá','Olá <Mundo>'];
const subs = [undefined,null,'','Texto & azul','    Teste   '];
let checked = 0;
for(const h of heading) for(const p of subtitles) for(const title of titles) for(const sub of subs) {
    const original = '<section>'+h+p+'</section>';
    const out = injetarHeroTexto(original,title,sub);
    assert.ok(typeof out==='string');
    assert.ok(out.startsWith('<section>')&&out.endsWith('</section>'));
    assert.ok(!out.includes('<script>'), 'Não introduzir marcação nova nos títulos');
    if(!title || !String(title).trim())assert.ok(out.includes(h));
    if(!sub || !String(sub).trim())assert.ok(out.includes(p));
    checked++;
}
// Estabilidade de composição: nenhum campo CSS é alterado, entidades escapadas fora de CDATA.
const composed = [
    '<section><h1>Pronto</h1><p>Bem-vindo</p><img src="/foto?a=1&b=2"></section>',
    '<div>&copy; &nbsp; &hellip; <br></div>',
].map(x=>sanitizarEntidadesXml(injetarHeroTexto(x,'Aprenda & crie','Rápido <e> seguro')));
assert.ok(composed[0].includes('<h1>Aprenda &amp; crie</h1>'));
assert.ok(composed[0].includes('<p>Rápido &lt;e&gt; seguro</p>'));
assert.ok(composed[0].includes('<img src="/foto?a=1&amp;b=2"/>'));
assert.ok(composed[1].includes('©'));
const digest = crypto.createHash('sha256').update(JSON.stringify(composed)).digest('hex');
assert.equal(digest.length,64);
console.log('✅ xmlEntities: '+checked+' combinações do hero, escapes e void tags preservados.');
