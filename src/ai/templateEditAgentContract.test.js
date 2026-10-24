'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const filename=require.resolve('./templateEditAgent');
const source=fs.readFileSync(filename,'utf8');
const messages=[],toolResponses=[],progress=[],callNames=[];
let applicationCalls=0;
const proposals={campos:{siteName:'Novo Nome'},resumo:'Mudar nome'};
const responses=[
    {candidates:[{content:{parts:[{functionCall:{name:'propor_edicao',args:{siteName:'Novo Nome',resumoMudancas:'Mudar nome'}}}]}}]},
    {candidates:[{content:{parts:[{functionCall:{name:'aplicar_edicao_pendente',args:{}}}]}}]},
    {candidates:[{content:{parts:[{functionCall:{name:'aplicar_edicao_pendente',args:{}}}]}}]},
    {candidates:[{content:{parts:[{text:'A proposta está pendente de confirmação.'}]}}]},
];
const mocked={
    '@google/genai':{
        GoogleGenAI:class{
            constructor(params){assert.equal(params.apiKey,'teste-somente');}
            chats={create:({history,config})=>{
                assert.ok(config.tools[0].functionDeclarations.length===5);
                assert.deepEqual(history,[]);
                return {sendMessage:async data=>{
                    messages.push(data);
                    const resp=responses.shift();
                    if(!resp)throw Error('Chat mock terminou');
                    if(Array.isArray(data.message)){
                        const part=data.message[0]?.parts[0]?.functionResponse;
                        if(part)toolResponses.push(part);
                    }
                    return resp;
                }};
            }};
        },
        HarmCategory:{HARM_CATEGORY_HARASSMENT:'h',HARM_CATEGORY_HATE_SPEECH:'hate',HARM_CATEGORY_SEXUALLY_EXPLICIT:'s',HARM_CATEGORY_DANGEROUS_CONTENT:'d'},
        HarmBlockThreshold:{BLOCK_ONLY_HIGH:'high'},
    },
    '../rag/ragAgent':{TokenBudget:class {track(){} isExhausted(){return false;}}},
    './templateEditSchema':{
        GEMINI_EDIT_RESPONSE_SCHEMA:{type:'object',required:['resumoMudancas'],properties:{}},
        validarEdicao(args){return {erros:[],camposAlterados:{siteName:args.siteName},resumoMudancas:args.resumoMudancas};}
    },
    '../core/templateEditWorker':{_resumirManifesto:m=>m},
    '../core/compilerEngine/dossieLoader':{carregarNichoDossie:()=>null},
    '../core/compilerEngine/pecaOrchestrator':{_tokensExternos:()=>[]},
    '../core/compilerEngine/workers/cssWorker':{validarTokensCss:()=>({ok:true,erros:[]})},
    '../core/compilerEngine/workers/jsWorker':{validarEscopoGlobal:()=>({ok:true,erro:''})},
};
const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
mod.require=id=>mocked[id]??require(id);mod._compile(source,filename);
const api=mod.exports;
assert.deepEqual(Object.keys(api),[
    'processarEdicaoAgentica','criarExecutorDeFerramentas','_labelParaFerramentaEdicao',
    '_extrairBlocosScript','_validarCamposLivres','TEMPLATE_EDIT_TOOL_DECLARATIONS'
]);
const before=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='teste-somente';
(async()=>{
    const result=await api.processarEdicaoAgentica([],'Quero mudar o nome',{
        manifestoAtual:{siteName:'Nome Atual'},propostaPendente:null,
        aplicarEdicaoReal:async()=>{applicationCalls++;return {downloadUrl:'https://example.invalid/modelo.xml'};},
        onProgress:evt=>{progress.push(evt);},
    });
    assert.equal(applicationCalls,0,'modelo não pode aplicar proposta recém-criada no mesmo turno');
    assert.equal(result.engajou,true);
    assert.deepEqual(result.propostaFinal,proposals,'proposta permanece pendente');
    assert.equal(result.downloadUrl,null);
    assert.equal(result.resposta,'A proposta está pendente de confirmação.');
    assert.deepEqual(progress.map(x=>x.label),[
        'Montando a proposta de edição...','Aplicando as alterações e recompilando...'
    ]);
    assert.equal(toolResponses.length,2);
    assert.equal(toolResponses[0].name,'propor_edicao');
    assert.equal(toolResponses[1].name,'aplicar_edicao_pendente');
    assert.match(toolResponses[1].response.erro,/não pode ser aplicada ainda/);
    assert.equal(messages[2].message,'[sistema] Continue com base nos resultados das ferramentas.');
    console.log('✅ templateEditAgent: Gemini simulado não ignora confirmação entre turnos.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
    if(before===undefined)delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY=before;
});
