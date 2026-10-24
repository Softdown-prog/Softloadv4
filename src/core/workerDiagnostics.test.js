'use strict';
const assert = require('node:assert/strict');
const { construirGrafoCampos } = require('./compilerEngine');
const { executarCompilacao } = require('./compilerWorker');
const { resumirGrafoCompilacao, listarErrosDiagnostico, montarEventoTelemetria, montarMetadadosCompilacao } = require('./workerDiagnostics');

function referenciaGrafo(trace, grafo) {
    const slotsAtivos = trace.filter(n => n.active).length;
    const camposInfluentes = [...grafo.campoParaSlots.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .map(([campo, slots]) => ({ campo, qtdSlots: slots.length, slots }));
    return { totalSlots: trace.length, slotsAtivos, camposInfluentes };
}
const referenciaDiagnostico = categorias => categorias
    .filter(c => c.achados.some(a => a.nivel === 'erro'))
    .map(c => c.nome + ': ' + c.achados.filter(a => a.nivel === 'erro').map(a => a.mensagem).join(' | '));
function referenciaEvento(timestamp, nichoTema, dossieDoNicho, avisos, diagnosticoErros) {
    return {
        timestamp,
        nichoTema: nichoTema || null,
        versaoDossie: dossieDoNicho ? dossieDoNicho.versaoDossie : null,
        pecasUsadas: dossieDoNicho ? dossieDoNicho.pecas.map(p => p.id) : [],
        validadoresPassaram: {
            xmlSemAvisos: avisos.length === 0,
            dossieDomIds: dossieDoNicho ? true : null,
            diagnosticoSemErros: diagnosticoErros === null ? null : diagnosticoErros === 0,
        },
        pecaGeradaPorIA: dossieDoNicho ? dossieDoNicho.pecas.some(p => p.origem === 'ia-gerada') : false,
    };
}
function referenciaMeta(xmlFinal, params, trace, grafo) {
    return {
        linhas: xmlFinal.split('\n').length,
        tamanhoKb: (Buffer.byteLength(xmlFinal, 'utf8') / 1024).toFixed(1),
        siteName: params.siteNameSanitizado,
        seo: params.seoAtivo,
        modulos: Object.keys(params.modulosAtivos).filter(k => params.modulosAtivos[k]),
        badges: params.badgesProcessados.length,
        grafo: referenciaGrafo(trace, grafo),
    };
}
let casos = 0;
for(let size=0;size<=30;size++) {
    const trace = Array.from({length:size},(_,i)=>({
        slot:'S'+i, active:i%3!==0,
        sources:['base'+(i%7),'comum',...(i%2===0?['par'+(i%4)]:[])],
    }));
    const grafo = construirGrafoCampos(trace);
    const got = resumirGrafoCompilacao(trace, grafo.campoParaSlots);
    const expected = referenciaGrafo(trace,grafo);
    assert.deepEqual(got,expected);
    assert.equal(JSON.stringify(got),JSON.stringify(expected));
    assert.ok(got.camposInfluentes.length<=5);
    const params = {
        siteNameSanitizado:'Café &amp; Tecnologia ☕',seoAtivo:size%2===0,
        modulosAtivos:{ativo:true,inativo:false,stringFalse:'false',vazio:'',objeto:{}},
        badgesProcessados:Array.from({length:size%9},(_,j)=>({nome:'B'+j})),
    };
    for(const xml of ['<xml/>','linha 1\nlinha 2\n','áéí ☕ &amp; <b:skin>']) {
        const meta = montarMetadadosCompilacao(xml,params,got);
        const legacy = referenciaMeta(xml,params,trace,grafo);
        assert.deepEqual(meta,legacy);
        assert.equal(JSON.stringify(meta),JSON.stringify(legacy));
        casos++;
    }
}
for(let size=0;size<=14;size++){
    const categorias=Array.from({length:size},(_,i)=>({
        nome:'Categoria '+i,
        achados:Array.from({length:i%4},(_,j)=>({nivel:j%2===0?'erro':'aviso',mensagem:'M'+i+'-'+j})),
    }));
    assert.deepEqual(listarErrosDiagnostico(categorias),referenciaDiagnostico(categorias));
    casos++;
}
const dossies=[
    null,
    {versaoDossie:'1.3',pecas:[]},
    {versaoDossie:2,pecas:[{id:'hero',origem:'autoral'},{id:'menu',origem:'ia-gerada'}]},
    {versaoDossie:0,pecas:[{id:'x',origem:'ia-gerada'}]},
];
for(const dossie of dossies) for(const nicho of [null,'','gamer-playerone'])
for(const avisos of [[],['XML aviso']]) for(const diagnosticoErros of [null,0,1,3]) {
    const timestamp='2026-10-22T22:00:00.000Z';
    const got=montarEventoTelemetria(timestamp,nicho,dossie,avisos,diagnosticoErros);
    const want=referenciaEvento(timestamp,nicho,dossie,avisos,diagnosticoErros);
    assert.deepEqual(got,want);
    assert.equal(JSON.stringify(got),JSON.stringify(want));
    casos++;
}
for(const nichoTema of [null,'gamer-playerone','noticias-mag-news']) {
    const result=executarCompilacao({siteName:'Café & Tecnologia',nichoTema,modules:{darkMode:false},categoryBadges:['tech']});
    assert.equal(result.meta.linhas,result.xmlFinal.split('\n').length);
    assert.equal(result.meta.tamanhoKb,(Buffer.byteLength(result.xmlFinal,'utf8')/1024).toFixed(1));
    assert.ok(result.meta.grafo.totalSlots>=result.meta.grafo.slotsAtivos);
    assert.ok(result.meta.grafo.camposInfluentes.length<=5);
    assert.equal(result.meta.siteName,result.siteNameSanitizado);
    casos++;
}
console.log('✅ workerDiagnostics: '+casos+' cenários de paridade para grafo, metadados, diagnóstico e telemetria.');
