'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {criarOrquestradorComMedicao}=require('./solarisProUsage');
function fixture(answers) {
 const queue=[...answers];let invoked=0;
 const api=criarOrquestradorComMedicao({
   modelRouter:{async executarTarefaArquitetura(){invoked++;return queue.shift();}},
   buscarConhecimento:null,
   criarOrquestrador:({modelRouter})=>({call:o=>modelRouter.executarTarefaArquitetura(o)})
 });
 return {...api, countCalls:()=>invoked};
}
test('soma tokens Pro de manifesto e arquivo, incluindo thinking faturável',async()=>{
 const f=fixture([
   {text:'manifest',usageMetadata:{promptTokenCount:320,candidatesTokenCount:110,thoughtsTokenCount:70}},
   {text:'arquivo',usageMetadata:{promptTokenCount:680,candidatesTokenCount:530,thoughtsTokenCount:90}},
 ]);
 await f.orquestrador.call({prompt:'manifesto'});
 await f.orquestrador.call({prompt:'arquivo'});
 assert.equal(f.contagem.input,1000);
 assert.equal(f.contagem.output,800);
 assert.equal(f.contagem.chamadas,2);
 assert.equal(f.contagem.estimadas,0);
});
test('metadado ausente usa fallback só nesta chamada, sem apagar anterior',async()=>{
 const f=fixture([
   {text:'A',usageMetadata:{promptTokenCount:40,candidatesTokenCount:15}},
   {text:'abcdefghij'},
 ]);
 await f.orquestrador.call({prompt:'abc'});
 await f.orquestrador.call({prompt:'abcdefghij'});
 assert.equal(f.contagem.input,43);
 assert.equal(f.contagem.output,18);
 assert.equal(f.contagem.estimadas,1);
});
test('não compartilha uso entre dois chats',async()=>{
 const a=fixture([{text:'x',usageMetadata:{promptTokenCount:20,candidatesTokenCount:20}}]);
 const b=fixture([{text:'y',usageMetadata:{promptTokenCount:15,candidatesTokenCount:15}}]);
 await a.orquestrador.call({prompt:'x'});
 await b.orquestrador.call({prompt:'y'});
 assert.equal(a.contagem.input,20);assert.equal(b.contagem.input,15);
});
