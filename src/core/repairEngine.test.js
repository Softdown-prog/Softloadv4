require('./test/isolatedTelemetry.cjs');
'use strict';

// Compilação testada sem gravações Firestore nem credenciais de produção.
// A persistência é coberta separadamente por contratos de telemetria.
const telemetryPath = require.resolve('./telemetria');
require.cache[telemetryPath] = {
    id: telemetryPath, filename: telemetryPath, loaded: true,
    exports: { registrarCompilacao() {} },
};
const assert = require('node:assert/strict');
const { repararXml, repararCssTruncado } = require('./repairEngine');
const { executarCompilacao } = require('./compilerWorker');

const clean = '<html><body><b:widget id="HTML301" type="HTML"><b:includable id="main">Tudo</b:includable></b:widget></body></html>';
const originalClean = repararXml(clean);
assert.deepEqual(originalClean,{xml:clean,reparos:[],total:0});
assert.equal(JSON.stringify(originalClean),JSON.stringify({xml:clean,reparos:[],total:0}));

// Regras ordenadas e nomes exatos, inclusive a chave histórica 'acao' sem cedilha.
const corrupted = '<b:loop="loop" values="x">[[A]] [[B_1]] [[A]]</b:loop="loop">';
const loop = repararXml(corrupted);
assert.equal(loop.xml,'<b:loop values="x">  </b:loop>');
assert.deepEqual(loop.reparos.map(r=>r.acção),['bloop_corruption_corrigido','orphan_tokens_removidos']);
assert.equal(loop.reparos[1].detalhes,'2 token(s) residual(ais): [[A]], [[B_1]]');
assert.deepEqual(repararXml(loop.xml).reparos,[]);
assert.equal(repararXml('[[minusculo]] [[OK]]').xml,'[[minusculo]] ');

// First widget ID stays unchanged, extra widgets are renumbered above any existing number.
const widgets="<b:widget id='HTML301' type='Blog'/><b:widget id=\"HTML301\" type='Blog'/><b:widget id='HTML980' type='Blog'/><b:widget id='HTML301' type='Blog'/>";
const widgetFixed=repararXml(widgets);
assert.equal(widgetFixed.xml,"<b:widget id='HTML301' type='Blog'/><b:widget id=\"HTML1081\" type='Blog'/><b:widget id='HTML980' type='Blog'/><b:widget id='HTML1082' type='Blog'/>");
assert.deepEqual(widgetFixed.reparos.map(x=>x.detalhes),['HTML301 → HTML1081','HTML301 → HTML1082']);
assert.deepEqual(repararXml(widgetFixed.xml).reparos,[]);

// Escapes occur in href/src/action, count attributes rather than individual ampersands.
const links="<a href='/?a=1&b=2&c=3' src=\"img?x=1&amp;y=2\" action='/x&z'>A & B</a><![CDATA[<a href='/&raw'>]]>";
const linksFixed=repararXml(links);
assert.equal(linksFixed.xml,"<a href='/?a=1&amp;b=2&amp;c=3' src=\"img?x=1&amp;y=2\" action='/x&amp;z'>A & B</a><![CDATA[<a href='/&raw'>]]>");
assert.equal(linksFixed.reparos.find(x=>x.acção==='amp_escapado_em_atributos').detalhes,
    '2 ocorrência(s) de & não escapado em href/src corrigida(s) (ex: &display= → &amp;display=)');
assert.equal(repararXml(linksFixed.xml).total,0);

// O código antigo não segmenta CDATA na regra de booleanos: preservar esse contrato.
const bool = '<video autoplay controls muted></video><form novalidate></form><![CDATA[<video autoplay>]]>';
const boolFixed = repararXml(bool);
assert.equal(boolFixed.xml,'<video autoplay="autoplay" controls="controls" muted="muted"></video><form novalidate="novalidate"></form><![CDATA[<video autoplay="autoplay">]]>');
assert.equal(boolFixed.reparos[0].acção,'boolean_attrs_normalizados');
assert.equal(repararXml(boolFixed.xml).total,0);

const unicode = "Texto\u00a0fino\u200b<b:loop\u2009values='x'></b:loop>";
const unicodeFixed=repararXml(unicode);
assert.equal(unicodeFixed.xml,"Texto fino<b:loop values='x'></b:loop>");
assert.equal(unicodeFixed.reparos[0].acao,'unicode_whitespace_normalizado');
assert.equal(Object.hasOwn(unicodeFixed.reparos[0],'acção'),false);
assert.equal(repararXml(unicodeFixed.xml).total,0);

// Reparar apenas widgets HTML sem includable, preservando settings como filhos legítimos.
const legacy="<b:widget id='HTML501' type='HTML'><b:widget-settings><b:widget-setting name='content'>a</b:widget-setting></b:widget-settings><div>Olá</div></b:widget>";
const result=repararXml(legacy);
assert.ok(result.xml.includes("<b:widget-settings><b:widget-setting name='content'>a</b:widget-setting></b:widget-settings>"));
assert.ok(result.xml.includes("<b:includable id='main'>\n<div>Olá</div>\n</b:includable>"));
assert.equal((result.xml.match(/<b:widget-settings>/g)||[]).length,1);
assert.equal(repararXml(result.xml).total,0);
assert.equal(repararXml("<b:widget type=\"HTML\"><div>x</div></b:widget>").total,0,
    'O match legado só aceita type entre aspas simples');

const comments="<!-- CSS --sl-primary -->\n<div>ok</div><![CDATA[<!-- CSS --sl-primary -->]]><!-- normal -->";
const commentsFixed=repararXml(comments);
assert.equal(commentsFixed.xml,"\n<div>ok</div><![CDATA[<!-- CSS --sl-primary -->]]><!-- normal -->");
assert.equal(commentsFixed.reparos[0].acção,'double_dash_em_comentario_removido');
assert.equal(repararXml(commentsFixed.xml).total,0);

for(const value of [null,undefined,17,false,{},[]]){
    assert.deepEqual(repararCssTruncado(value),{css:value,reparado:false});
}
for(const css of ['', 'div{}', 'a { color: red; }','/* { } */','a {color:red;}\n']){
    assert.deepEqual(repararCssTruncado(css),{css,reparado:false});
}
assert.deepEqual(repararCssTruncado('a {color:red'),{css:'a {color:red\n}',reparado:true});
assert.deepEqual(repararCssTruncado('a { b { color:red'),{css:'a { b { color:red\n}}',reparado:true});
assert.deepEqual(repararCssTruncado('/* ignored { */ a {x:y'),{css:'/* ignored { */ a {x:y\n}',reparado:true});
for(const css of ['.x{a:1','.a {color:red', 'div{a{b{x:y'] ){
    const first=repararCssTruncado(css);
    assert.equal(repararCssTruncado(first.css).reparado,false,'CSS must be repaired once: '+css);
}
// Validates XML postcompile and ensures the repairer is idempotent against real templates.
for(const nichoTema of [null,'gamer-playerone','tecnologia-techwind','biolink-social']){
    const compiled=executarCompilacao({siteName:'Reparo de XML e CSS',nichoTema});
    const checked=repararXml(compiled.xmlFinal);
    assert.equal(checked.xml,compiled.xmlFinal,'Compilação real deve produzir XML já reparado');
    assert.equal(checked.total,0,'Reparo de segunda passagem deve ser idempotente');
}
console.log('✅ repairEngine: sequência de regras, CDATA, IDs, XML Blogger, CSS truncado e idempotência.');
