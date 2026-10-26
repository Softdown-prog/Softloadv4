'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'chatGenerationFlow.js'), 'utf8');
const marker='[[TEMPLATE:{"siteName":"Loja"}]]';

function createHarness({gpt=false,permitirGeracao=false,stream='Resposta normal',compileFails=false,uid='user-1',wsSnapshot=null,ragHits=[]}={}) {
    const events=[],calls={gemini:0,gpt:0,compile:0,memory:0,validation:0};
    const tokensRef={};
    const testResult={downloadUrl:'https://downloads.example.test/loja.xml',snapshot:{siteName:'Loja'}};
    const originalSystem='SUPORTE TESTE', generationSystem='GERACAO TESTE';
    const dependencies={
        '../../../services/geminiService': {async *gerarChatStream(history,msg,system,opts){
            calls.gemini++;calls.lastSystem=system;calls.opts=opts;
            yield stream.slice(0,8);yield stream.slice(8);
        }},
        '../../../services/openaiService': {async *gerarChatGptStream(history,msg,system,opts){
            calls.gpt++;calls.lastSystem=system;calls.opts=opts;
            yield stream;
        }},
        '../../../rag/ragLoader':{
            rotearPergunta(){return 'suporte';},
            loadForGeminiSync(){return {sucesso:true,contextoStr:'RAG CONTEXTO'};}
        },
        '../../../services/chatStorageService': {
            async loadMemory(actualUid){calls.memory++;assert.equal(actualUid,uid);return {summary:'Salvo'};},
            formatMemoryForPrompt(){return '\nMEMORIA PREVIA';}
        },
        './chatCodeValidator': {async _validarECorrigir(text){
            calls.validation++;return {finalText:text,validation:{checked:0,ok:true,retried:false,fixApplied:false}};
        }},
        './chatTemplateCompiler': {async _compilarParaChat(blueprint,user,send,options){
            calls.compile++;
            assert.equal(blueprint.siteName,'Loja');
            assert.equal(user.uid,uid);
            if(compileFails)throw Error('compiler down');
            return testResult;
        }},
        './chatRag': {buscarRagRelevante(){return ragHits;},montarContextoRag(){return '\nRAG IMPORTANTE';}},
        './chatRagGpt': {buscarRagGpt(){return gpt?['foundation']:[];},montarContextoRagGpt(){return '\nPADROES GPT';}},
        './chatTemplateContext':{
            buscarContextoTemplate:async()=>null,
            montarContextoTemplate:()=>'\nCONTEXT',
            precisaContextoTemplate:()=>false,
        },
        './chatWorkspaceContext':{montarContextoWorkspace:()=>'\nWORKSPACE CONTEXT'},
        './chatSystemPrompt':{SISTEMA_GERACO:'GERACAO WRONG',SISTEMA_GERACAO:generationSystem,SISTEMA_SUPORTE:originalSystem}
    };
    const module={exports:{}};
    vm.runInNewContext(source,{
        module,exports:{},console:{log(){},warn(){},error(){}},
        require(p){if(!Object.hasOwn(dependencies,p))throw Error('Unmocked dependency: '+p);return dependencies[p];}
    },{filename:'chatGenerationFlow.js'});
    return {async run(){
        return module.exports.gerarComPossivelTemplate({
            msg:'crie um site',safeHistory:[{role:'user',content:'quero uma loja'}],
            isGpt:gpt,wsSnapshot,email:'user@example.test',uid,
            user:{uid},tokensRef,sendEvent:x=>events.push(x),
            permitirGeracao,wsProjetoId:permitirGeracao?'project':null,
            wsSessionId:permitirGeracao?'session':null
        });
    },calls,events,tokensRef};
}
test('Especialista nunca compila marcador sem gate de Workspace',async()=>{
    const f=createHarness({stream:'Olá '+marker,permitirGeracao:false});
    const out=await f.run();
    assert.equal(f.calls.compile,0);
    assert.equal(f.calls.gemini,1);
    assert.equal(out.downloadUrl,null);
    assert.equal(out.novoSnapshot,null);
    assert.equal(out.fullText,'Olá');
    assert.equal(f.calls.validation,1);
    assert.equal(f.calls.memory,1);
    assert.match(f.calls.lastSystem,/MEMORIA PREVIA/);
    assert.equal(f.calls.opts.maxOutputTokens,8192);
});
test('GPT não pode compilar mesmo quando permitirGeracao é true',async()=>{
    const f=createHarness({gpt:true,permitirGeracao:true,stream:'Oi '+marker});
    const out=await f.run();
    assert.equal(f.calls.compile,0);
    assert.equal(f.calls.gpt,1);
    assert.equal(out.downloadUrl,null);
    assert.equal(out.fullText,'Oi');
    assert.match(f.calls.lastSystem,/PADROES GPT/);
    assert.equal(f.calls.opts.maxOutputTokens,2048);
});
test('Workspace Gemini compila marcador e devolve versão para histórico',async()=>{
    const f=createHarness({permitirGeracao:true,stream:'Template pronto '+marker,wsSnapshot:{siteName:'Loja'},ragHits:[{arquivo:'a'}]});
    const out=await f.run();
    assert.equal(f.calls.compile,1);
    assert.equal(out.fullText,'Template pronto');
    assert.equal(out.downloadUrl,'https://downloads.example.test/loja.xml');
    assert.equal(out.novoSnapshot.siteName,'Loja');
    assert.match(f.calls.lastSystem,/WORKSPACE CONTEXT/);
    assert.match(f.calls.lastSystem,/RAG IMPORTANTE/);
    assert.match(f.calls.lastSystem,/Histórico de Versões/);
    assert.ok(f.events.some(x=>x.type==='status'&&x.label.includes('Montando seu template')));
});
test('falha do compilador retorna mensagem explícita sem download fantasma',async()=>{
    const f=createHarness({permitirGeracao:true,compileFails:true,stream:'Seu download aparecerá aqui '+marker});
    const out=await f.run();
    assert.equal(f.calls.compile,1);
    assert.equal(out.downloadUrl,null);
    assert.equal(out.novoSnapshot,null);
    assert.match(out.fullText,/compilação falhou/);
    assert.doesNotMatch(out.fullText,/download aparecerá/);
});
test('marcador truncado é removido, não há compilação',async()=>{
    const f=createHarness({permitirGeracao:true,stream:'Tudo certo [[TEMPLATE:{"siteName":"incompleto" '});
    const out=await f.run();
    assert.equal(out.fullText,'Tudo certo');
    assert.equal(f.calls.compile,0);
});
