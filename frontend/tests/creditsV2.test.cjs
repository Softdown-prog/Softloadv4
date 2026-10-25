'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const code=fs.readFileSync(path.join(__dirname,'../services/creditsV2.ts'),'utf8');
const transpiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};
vm.runInNewContext(transpiled,{module:mod,exports:mod.exports,Number,Date,fetch() {throw Error('unexpected network')}});
const {normalizarResumoCreditosV2,buscarPreviaCreditosV2}=mod.exports;
const valid={versao:2,modo:'previsualizacao',cicloExpiraEm:'2099-01-01T00:00:00Z',
  saldo:{creditosDoCiclo:500,creditosDisponiveis:325,creditosConsumidos:150,creditosReservados:25,creditosExcedentes:0,preliminar:true}};
test('interpreta dados aprovados e não mistura com créditos legados',()=>{
  const result=normalizarResumoCreditosV2(valid);
  assert.equal(result.saldo.creditosDisponiveis,325);
  assert.equal(result.saldo.creditosReservados,25);
  assert.equal(result.saldo.creditosDoCiclo,500);
  assert.equal(Object.prototype.hasOwnProperty.call(result,'creditos'),false);
});
test('recusa payload incorreto, saldo inválido e prévia não identificada',()=>{
  for(const input of [null,{},[],{...valid,versao:1},{...valid,modo:'ativo'},
    {...valid,cicloExpiraEm:'not a date'}, {...valid,saldo:{...valid.saldo,creditosDisponiveis:800}},
    {...valid,saldo:{...valid.saldo,creditosConsumidos:NaN}}, {...valid,saldo:{...valid.saldo,creditosReservados:-1}},
    {...valid,saldo:{...valid.saldo,preliminar:false}}]) assert.equal(normalizarResumoCreditosV2(input),null);
});
test('apenas HTTP 200 com JSON válido alimenta a prévia',async()=>{
  const calls=[];
  const get=async (url,config)=>{calls.push({url,config});return {ok:true,json:async()=>valid};};
  const result=await buscarPreviaCreditosV2(get);
  assert.equal(result.saldo.creditosDisponiveis,325);
  assert.equal(calls[0].url,'/api/ai-credits/v2');
  assert.equal(calls[0].config.cache,'no-store');
  assert.equal(calls[0].config.credentials,'same-origin');
});
test('prévia 404/503, sessão expirada e falha de rede nunca quebram o dashboard',async()=>{
  for(const response of [404,401,402,503]) {
    assert.equal(await buscarPreviaCreditosV2(async()=>({ok:false,status:response})),null);
  }
  assert.equal(await buscarPreviaCreditosV2(async()=>{throw Error('network offline')}),null);
  assert.equal(await buscarPreviaCreditosV2(async()=>({ok:true,json:async()=>({erro:'not available'})})),null);
});
