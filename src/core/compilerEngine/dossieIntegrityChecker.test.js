'use strict';
const assert = require('node:assert/strict');
const { verificarDomIdsNoOutput, verificarSecoesPreenchidas, SECOES_MOBILIA_ESPERADAS } = require('./dossieIntegrityChecker');
const compilerEngine = require('./index');
const { executarCompilacao } = require('../compilerWorker');
const { carregarNichoDossie } = require('./dossieLoader');
const { chassisParaNicho } = require('../nichoTaxonomy');

assert.equal(compilerEngine.verificarDomIdsNoOutput, verificarDomIdsNoOutput);
assert.deepEqual(Object.keys(SECOES_MOBILIA_ESPERADAS).slice(0,5),['blog','magazine','saas','portfolio','base']);
assert.deepEqual(SECOES_MOBILIA_ESPERADAS['pop-retro-pixel'], []);
assert.deepEqual(SECOES_MOBILIA_ESPERADAS['tecnologia-mag-tech'], []);
assert.deepEqual(SECOES_MOBILIA_ESPERADAS['viral-magazine'], ['sidebar-right','footer-1','footer-2','footer-3']);
assert.deepEqual(SECOES_MOBILIA_ESPERADAS['gamer-playerone'], ['top-bar-right','footer-col-4']);

const ok = {ok:true,erros:[]};
assert.deepEqual(verificarDomIdsNoOutput('',null),ok);
assert.deepEqual(verificarDomIdsNoOutput(null,{pecas:[]}),ok);
assert.deepEqual(verificarDomIdsNoOutput('qualquer',{}),ok);
assert.deepEqual(verificarDomIdsNoOutput('qualquer',{pecas:null}),ok);
assert.deepEqual(verificarDomIdsNoOutput('qualquer',{pecas:[]}),ok);
assert.deepEqual(verificarDomIdsNoOutput("<div id='a'></div><div id=\"b\"></div>", {
    pecas:[{id:'hero',domIds:['a','b']}],
}),ok);
assert.deepEqual(verificarDomIdsNoOutput("<div id='a'></div>", {
    pecas:[{id:'hero',domIds:['a','b','c']},{id:'menu',domIds:['b']}],
}),{
    ok:false,
    erros:[
      'peça "hero" declara domIds incluindo #b mas o elemento id=\'b\' não aparece no XML compilado — HTML órfão.',
      'peça "hero" declara domIds incluindo #c mas o elemento id=\'c\' não aparece no XML compilado — HTML órfão.',
      'peça "menu" declara domIds incluindo #b mas o elemento id=\'b\' não aparece no XML compilado — HTML órfão.',
    ],
});
assert.deepEqual(verificarDomIdsNoOutput("<div ID='a'/>",{pecas:[{id:'x',domIds:['a']}]}).ok,false,'IDs continuam case sensitive');
assert.deepEqual(verificarDomIdsNoOutput("<div id = 'a'/>",{pecas:[{id:'x',domIds:['a']}]}).ok,false,'Sem flexibilidade adicional no whitespace');
assert.deepEqual(verificarDomIdsNoOutput("<!-- id='a' -->",{pecas:[{id:'x',domIds:['a']}]}),ok,'Busca textual legada inclui comentários');
assert.deepEqual(verificarDomIdsNoOutput("<![CDATA[id=\"a\"]]>",{pecas:[{id:'x',domIds:['a']}]}),ok,'Busca textual legada inclui CDATA');
assert.deepEqual(verificarDomIdsNoOutput('XML',{pecas:[{id:'x',domIds:'a'}]}),ok,'domIds não-array é ignorado');

assert.deepEqual(verificarSecoesPreenchidas('<b:section id="sidebar"/>','blog').erros,[
    "seção de mobília <b:section id='sidebar'> saiu vazia (auto-fechada) no XML compilado — esperava ao menos 1 widget nativo (ver SECOES_MOBILIA_ESPERADAS em dossieIntegrityChecker.js).",
]);
assert.deepEqual(verificarSecoesPreenchidas('<b:section id="sidebar" />','blog').ok,false);
assert.deepEqual(verificarSecoesPreenchidas("<b:section id='sidebar'><b:widget/></b:section>",'blog'),ok);
assert.deepEqual(verificarSecoesPreenchidas('nenhuma seção','blog'),ok,'Legado não considera seção ausente como erro');
assert.deepEqual(verificarSecoesPreenchidas('<b:section id="sidebar"/>','desconhecido'),ok);
assert.deepEqual(verificarSecoesPreenchidas('<b:section id="sidebar"/>','blog','pop-retro-pixel'),ok,'Override [] não deve cair no chassis');
assert.deepEqual(verificarSecoesPreenchidas('<b:section id="sidebar"/>','magazine','tecnologia-mag-tech'),ok);
assert.deepEqual(verificarSecoesPreenchidas('<b:section id="sidebar-right"/>','magazine','viral-magazine').erros.length,1);
assert.deepEqual(verificarSecoesPreenchidas('<b:section id="sidebar"/>','magazine','viral-magazine'),ok);
assert.deepEqual(verificarSecoesPreenchidas('<b:section id="sidebar"/>','blog','nao-existe').ok,false,'Fallback por chassis');
const multi="<b:section id='footer-3'/><b:section id=\"sidebar\"/><b:section id='footer-2'/>";
const result=verificarSecoesPreenchidas(multi,'blog');
assert.deepEqual(result.erros.map(x=>x.match(/id='([^']+)'/)[1]), ['sidebar','footer-2','footer-3'],'Ordem declarada, não ordem do XML');

const expected = (xml,dossie) => {
    const errors=[];
    for(const peca of dossie.pecas)for(const id of (Array.isArray(peca.domIds)?peca.domIds:[])) {
        if(!xml.includes("id='"+id+"'")&&!xml.includes('id="'+id+'"'))
            errors.push('peça "'+peca.id+'" declara domIds incluindo #'+id+" mas o elemento id='"+id+"' não aparece no XML compilado — HTML órfão.");
    }
    return {ok:errors.length===0,erros:errors};
};
let cases=0;
for(let mask=0;mask<256;mask++) {
    let xml='';
    for(let i=0;i<8;i++) if((mask>>i)&1) xml+="<div id='"+String.fromCharCode(97+i)+"'></div>";
    const dossie={pecas:[
        {id:'header',domIds:['a','c','h']},
        {id:'footer',domIds:['b','f','f','g']},
    ]};
    assert.deepEqual(verificarDomIdsNoOutput(xml,dossie),expected(xml,dossie));
    cases++;
}
for(const nichoTema of ['gamer-playerone','biolink-social','tecnologia-techwind']){
    const dossie=carregarNichoDossie(nichoTema);
    assert.ok(dossie && Array.isArray(dossie.pecas));
    const xml=executarCompilacao({siteName:'Teste integridade dos dossiês',nichoTema}).xmlFinal;
    assert.deepEqual(verificarDomIdsNoOutput(xml,dossie),ok);
    assert.deepEqual(verificarSecoesPreenchidas(xml,chassisParaNicho(nichoTema),nichoTema),ok);
    cases++;
}
console.log('✅ dossieIntegrityChecker: '+cases+' cenários de DOM IDs, fallbacks, seções e compilações reais.');
