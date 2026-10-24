'use strict';
const assert = require('node:assert/strict');
const { criarExecutorCompilacao } = require('./workerOrchestrator');
const { temHeroProtegido, prepararDesignPackage, temCamposDesignPackage } = require('./workerHeroGuard');

function harness(overrides = {}) {
    const calls = [], logs = [], warnings = [], errors = [];
    const params = {
        siteName:'Teste',siteNameSanitizado:'Teste',slug:'teste',nichoTema:'gamer-playerone',
        description:null,seoAtivo:true,gridLayout:'revista',colorPreset:'tech-blue',buttonStyle:'default',
        typography:'inter',modulosAtivos:{darkMode:true},badgesProcessados:[],lazyLoadAtivo:true,
        footerStyle:'advanced-3-cols',sidebarPosition:'right',heroTitle:null,heroSubtitle:null,designVoice:'auto',
    };
    let compiledOptions, designBody;
    const deps = {
        validarManifesto: () => {calls.push('validar');return []},
        normalizarManifesto: () => {calls.push('normalizar');return params;},
        manifestDependencies: {},
        carregarChassisParaNicho: () => {calls.push('chassis');return 'BASE';},
        carregarNichoDossie: () => {calls.push('dossie');return null;},
        temHeroProtegido,
        prepararDesignPackage,
        temCamposDesignPackage,
        compilarTemplate: (_base,options) => {calls.push('compilar');compiledOptions=options;return {xml:'XML',trace:[]};},
        construirGrafoCampos: () => {calls.push('grafo');return {campoParaSlots:new Map()};},
        resumirGrafoCompilacao: () => ({totalSlots:0,slotsAtivos:0,camposInfluentes:[]}),
        injetarDesignPackage: (_xml,body) => {calls.push('design');designBody=body;return {xml:'XML-DP',injecoes:['staticSections']};},
        designPackageDependencies: {},
        repararXml: xml => {calls.push('reparar');return {xml,reparos:[]};},
        verificarDomIdsNoOutput: () => {calls.push('integridade');return {ok:true,erros:[]};},
        validarXmlSaida: () => {calls.push('xml');return [];},
        gerarDiagnostico: () => {calls.push('diagnostico');return {totalErros:0,categorias:[]};},
        listarErrosDiagnostico: () => [],
        montarEventoTelemetria: (...args) => {calls.push('evento');return {args};},
        montarMetadadosCompilacao: () => {calls.push('meta');return {linhas:1,tamanhoKb:'0.0',siteName:'Teste',seo:true,modulos:[],badges:0,grafo:{totalSlots:0,slotsAtivos:0,camposInfluentes:[]}};},
        registrarCompilacao: () => {calls.push('telemetria');},
        now: () => '2026-10-22T00:00:00.000Z',
        log: (...args) => logs.push(args),warn: (...args) => warnings.push(args),error: (...args) => errors.push(args),
        ...overrides,
    };
    const execute = criarExecutorCompilacao(deps);
    return {execute,calls,logs,warnings,errors,params,getOptions:()=>compiledOptions,getBody:()=>designBody};
}
{
    const h=harness();
    const result=h.execute({siteName:'Teste'});
    assert.deepEqual(h.calls,['validar','normalizar','chassis','dossie','compilar','grafo','reparar','xml','diagnostico','evento','telemetria','meta']);
    assert.equal(result.xmlFinal,'XML');
    assert.deepEqual(Object.keys(result),['xmlFinal','avisos','reparosXml','injecoesPackage','slug','siteNameSanitizado','modulosAtivos','badgesProcessados','meta']);
}
{
    const h=harness({validarManifesto:()=>['siteName obrigatório','nicho inválido']});
    assert.throws(()=>h.execute({}),/\[MANIFEST\] siteName obrigatório \| nicho inválido/);
    assert.deepEqual(h.calls,[]);
}
{
    const h=harness({compilarTemplate:()=>{throw new Error('quebra') }});
    assert.throws(()=>h.execute({siteName:'Teste'}),/\[ENGINE\] Falha na compilação: quebra/);
    assert.ok(!h.calls.includes('telemetria'));
}
{
    const h=harness({carregarNichoDossie:()=>({versaoDossie:1,pecas:[{id:'h',tipo:'hero',protegida:true}]})});
    const result=h.execute({siteName:'Teste',heroHtml:'<h1>Outro hero</h1>',staticSections:'<p>Extra</p>'});
    assert.equal(h.getOptions().temHeroDesignPackage,false);
    assert.equal(h.getBody().heroHtml,undefined);
    assert.equal(h.getBody().staticSections,'<p>Extra</p>');
    assert.equal(result.xmlFinal,'XML-DP');
    assert.ok(h.calls.includes('integridade'));
}
{
    const h=harness();h.execute({siteName:'Teste',heroHtml:'  <h1>Hero</h1>  '});
    assert.equal(h.getOptions().temHeroDesignPackage,true);
    assert.equal(h.getBody().heroHtml,'  <h1>Hero</h1>  ');
}
{
    const h=harness({carregarNichoDossie:()=>({versaoDossie:1,pecas:[{id:'h',tipo:'hero',protegida:true}]}),
        verificarDomIdsNoOutput:()=>({ok:false,erros:['domId ausente']})});
    assert.throws(()=>h.execute({siteName:'Teste'}),/\[DOSSIE\] Integridade do nicho "gamer-playerone" violada: domId ausente/);
    assert.ok(!h.calls.includes('diagnostico'));
    assert.ok(!h.calls.includes('telemetria'));
}
{
    const h=harness({gerarDiagnostico:()=>{throw new Error('indisponível')}});
    h.execute({siteName:'Teste'});
    assert.match(h.warnings.at(-1)[0],/Safety-net do Diagnóstico falhou/);
    assert.ok(h.calls.includes('telemetria'));
}
{
    const h=harness({repararXml:()=>({xml:'XML',reparos:[{acção:'reparado'}]}),
        validarXmlSaida:()=>['avisos'],
        gerarDiagnostico:()=>({totalErros:1,categorias:[{nome:'XML',achados:[{nivel:'erro',mensagem:'erro'}]}]}),
        listarErrosDiagnostico:()=>['XML: erro']});
    const out=h.execute({siteName:'Teste'});
    assert.deepEqual(out.avisos,['avisos']);
    assert.ok(h.warnings.some(x=>x[0]==='[COMPILER-WORKER] XML reparado:'));
    assert.ok(h.errors.some(x=>String(x[0]).includes('1 erro(s) real(is)')));
}
console.log('✅ workerOrchestrator: manifesto, erros, hero protegido, integridade, safety-net e ordem.');
