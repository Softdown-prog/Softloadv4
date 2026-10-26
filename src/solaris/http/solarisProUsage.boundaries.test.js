'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {criarOrquestradorComMedicao}=require('./solarisProUsage');
function fixture(answers) {
    let calls=0;
    const queue=[...answers];
    const {orquestrador,contagem}=criarOrquestradorComMedicao({
        modelRouter:{async executarTarefaArquitetura(){calls++;return queue.shift();}},
        buscarConhecimento:null,
        criarOrquestrador:({modelRouter})=>({call:(options)=>modelRouter.executarTarefaArquitetura(options)})
    });
    return {orquestrador,contagem,calls:()=>calls};
}
test('token metadata inválido usa estimativa e mantém contabilização válida',async()=>{
    const f=fixture([{text:'12345',usageMetadata:{promptTokenCount:-10,candidatesTokenCount:5}}]);
    await f.orquestrador.call({prompt:'abc'});
    assert.equal(f.contagem.input,1);
    assert.equal(f.contagem.output,2);
    assert.equal(f.contagem.estimadas,1);
});
test('soma que ultrapassa inteiro seguro é recusada sem somar os tokens inválidos',async()=>{
    const f=fixture([
        {text:'a',usageMetadata:{promptTokenCount:Number.MAX_SAFE_INTEGER,candidatesTokenCount:1}},
        {text:'b',usageMetadata:{promptTokenCount:2,candidatesTokenCount:1}}
    ]);
    await f.orquestrador.call({prompt:'a'});
    await assert.rejects(()=>f.orquestrador.call({prompt:'b'}),/Medição de tokens inválida/);
    assert.equal(f.contagem.input,Number.MAX_SAFE_INTEGER);
    assert.equal(f.contagem.output,1);
});
test('configuração inválida é recusada antes de instanciar o orquestrador',()=>{
    assert.throws(()=>criarOrquestradorComMedicao({modelRouter:{},criarOrquestrador:()=>({}),buscarConhecimento:null}),/Orquestrador inválido/);
});
