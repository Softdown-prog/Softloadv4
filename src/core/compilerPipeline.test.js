'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const filename = require.resolve('./compilerPipeline');
const source = fs.readFileSync(filename, 'utf8');
function ambiente() {
    const events = [], state = {
        enrichFail:false, compileFail:false, xmlErrors:[],
        estrutura:{erros:[],avisos:[]},semantica:{erros:[],avisos:[]}
    };
    let persist, compiled;
    const mocks = {
        './blueprintEnricher': {enriquecerBlueprint: async (blueprint, onStatus) => {
            events.push('ENRICH');
            if (state.enrichFail) throw Error('enricher indisponível');
            onStatus('Personalizando identidade visual...');
            return {...blueprint,heroHtml:'<h1>Hero Rico</h1>',customCss:'.marca{}'};
        }},
        './compilerWorker': {executarCompilacao: manifesto => {
            events.push('COMPILE'); compiled=manifesto;
            if (state.compileFail) throw Error('erro motor');
            return {xmlFinal:'<html><head></head><body></body></html>',slug:'site',siteNameSanitizado:'Meu Site'};
        }},
        './xmlValidator': {
            validarXmlCompilado: () => {events.push('VERIFY_XML');return state.xmlErrors;},
            validarXmlEstrutura: () => {events.push('VERIFY_ESTRUTURA');return state.estrutura;},
            validarSemanticaBlogger: () => {events.push('VERIFY_SEMANTICA');return state.semantica;}
        },
        '../services/storageService': {
            reservarCota: async (email,plano,bytes) => {
                events.push('RESERVAR');
                assert.equal(email,'user@example.test');assert.equal(plano,'free');
                assert.ok(bytes>0);
                return {confirmarUso: async (count,operationId) => {
                    events.push('CONFIRMAR');
                    assert.equal(count,320);
                    assert.equal(operationId,'blogger-compilation:doc-1');
                }};
            },
            salvarCompilacao: async (uid,slug,xml,manifesto) => {
                events.push('SALVAR');
                assert.equal(uid,'uid-1');assert.equal(slug,'site');
                assert.ok(xml.includes('html'));assert.ok(manifesto && typeof manifesto==='object');
                return {gcPath:'gc/zip',xmlPath:'gc/xml',manifestoPath:'gc/manifesto',nomeArquivo:'site.zip',tamanhoBytes:320};
            }
        },
        '../services/firebase': {db:{collection: name => {
            assert.equal(name,'clientes_premium');
            return {doc: email => {
                assert.equal(email,'user@example.test');
                return {collection: sub => {
                    assert.equal(sub,'compilacoes');
                    return {add: async data => {events.push('PERSISTIR');persist=data;return {id:'doc-1'};}};
                }};
            }};
        }}},
        'firebase-admin': {firestore:{FieldValue:{serverTimestamp:()=> 'SERVER_TIMESTAMP'}}}
    };
    const mod=new Module(filename,module);
    mod.filename=filename;mod.paths=module.paths;
    mod.require=id => mocks[id] ?? require(id);
    mod._compile(source,filename);
    return {api:mod.exports,events,state,get persist(){return persist;},get compiled(){return compiled;}};
}
const user={uid:'uid-1',email:'USER@EXAMPLE.TEST',plano:'free'};
const ctx={slug:'site',siteNameSanitizado:'Meu Site',manifesto:{siteName:'Meu Site',nichoTema:'gamer-playerone'},wsProjetoId:'project',wsSessionId:'session',resumoMudancas:'Nova cor'};
(async () => {
    const env=ambiente(),status=[];
    assert.deepEqual(Object.keys(env.api),['compilarComPipeline','finalizarCompilacao']);
    const saved=await env.api.finalizarCompilacao('<html/>',ctx,user,s=>status.push(s));
    assert.deepEqual(saved,{downloadUrl:'/dashboard/compilacao/doc-1/download',xmlPath:'gc/xml',gcPath:'gc/zip'});
    assert.deepEqual(env.events,['VERIFY_XML','VERIFY_ESTRUTURA','VERIFY_SEMANTICA','RESERVAR','SALVAR','PERSISTIR','CONFIRMAR']);
    assert.deepEqual(status,['Verificando integridade do template...','Empacotando e salvando...']);
    assert.equal(env.persist.siteName,'Meu Site');
    assert.equal(env.persist.wsProjetoId,'project');
    assert.equal(env.persist.wsSessionId,'session');
    assert.equal(env.persist.resumoMudancas,'Nova cor');
    assert.equal(env.persist.criadoEm,'SERVER_TIMESTAMP');
    assert.equal(env.persist.manifestoPath,'gc/manifesto');
    assert.ok(!('manifesto' in env.persist),'Firestore armazena path e não manifesto completo');

    const semWs=ambiente();
    await semWs.api.finalizarCompilacao('<html/>',{slug:'site',siteNameSanitizado:'Meu Site',manifesto:{}},user);
    assert.equal(semWs.persist.wsProjetoId,null);
    assert.equal(semWs.persist.wsSessionId,null);
    assert.equal(semWs.persist.resumoMudancas,null);
    for(const [key,bad,message] of [
        ['xmlErrors',['xml inválido'],'[PIPELINE/VERIFY] XML inválido'],
        ['estrutura',{erros:['sem Blog1'],avisos:[]},'[PIPELINE/VERIFY] Estrutura inválida'],
        ['semantica',{erros:['widget rejeitado'],avisos:[]},'[PIPELINE/VERIFY] Semântica Blogger inválida']
    ]) {
        const item=ambiente();item.state[key]=bad;
        await assert.rejects(item.api.finalizarCompilacao('<html/>',ctx,user),err=>err.message.includes(message));
        assert.ok(!item.events.includes('RESERVAR')&&!item.events.includes('SALVAR'),'falha antes de cota/upload');
    }
    const compiled=ambiente(),blueprint={siteName:'Meu Site'},manifesto={siteName:'Meu Site',heroHtml:'',customCss:''};
    await compiled.api.compilarComPipeline(blueprint,manifesto,user,()=>{}, {wsProjetoId:'proj-2'});
    assert.deepEqual(compiled.events.slice(0,2),['ENRICH','COMPILE']);
    assert.equal(compiled.compiled.heroHtml,'<h1>Hero Rico</h1>');
    assert.equal(compiled.compiled.customCss,'.marca{}');
    assert.equal(manifesto.heroHtml,'','não alterar manifesto original');
    assert.equal(compiled.persist.enriched,true);
    assert.equal(compiled.persist.wsProjetoId,'proj-2');
    const fallback=ambiente();fallback.state.enrichFail=true;
    await fallback.api.compilarComPipeline(blueprint,{siteName:'Meu Site',customCss:'.manual{}'},user);
    assert.deepEqual(fallback.events.slice(0,2),['ENRICH','COMPILE']);
    assert.equal(fallback.persist.enriched,false);
    assert.equal(fallback.compiled.customCss,'.manual{}');
    const broken=ambiente();broken.state.compileFail=true;
    await assert.rejects(broken.api.compilarComPipeline(blueprint,{siteName:'Meu Site'},user), /\[PIPELINE\/COMPILE\]/);
    assert.ok(!broken.events.includes('RESERVAR'));
    console.log('✅ compilerPipeline: cinco etapas, quotas, fallback e persistência Firestore.');
})().catch(err=>{console.error(err);process.exitCode=1;});
