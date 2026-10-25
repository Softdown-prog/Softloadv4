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

test('extrato V2 aceita lançamentos íntegros e ignora campos financeiros internos',async()=>{
  const id='a'.repeat(64);
  const raw={versao:2,modo:'previsualizacao',itens:[{
    id,ferramenta:'solaris-chat',modelo:'gemini-2.5-pro',projeto:'session-xyz123',
    criadoEm:'2026-10-25T13:00:00Z',creditos:7,estimado:true,
    custoRealMicroBrl:123000,prompt:'secreto',
  }]};
  const result=mod.exports.normalizarExtratoCreditosV2(raw);
  assert.equal(result.itens.length,1);
  assert.equal(result.itens[0].creditos,7);
  assert.equal(result.itens[0].estimado,true);
  assert.equal(result.itens[0].custoRealMicroBrl,undefined);
  assert.equal(result.itens[0].prompt,undefined);
});
test('extrato V2 recusa registros adulterados, tipos incorretos e URLs desabilitadas',async()=>{
  const id='f'.repeat(64);
  const base={id,ferramenta:'solaris-upload',modelo:'gemini-2.5-pro',
    criadoEm:'2026-10-25T13:00:00Z',creditos:5,estimado:false};
  const cases=[
    {...base,creditos:-1},{...base,creditos:NaN},{...base,id:'../../hack'},
    {...base,modelo:'openai-test'},{...base,criadoEm:'tomorrow'}, {...base,projeto:'../secret'},
    {...base,estimado:'yes'}
  ];
  for(const bad of cases)assert.equal(mod.exports.normalizarExtratoCreditosV2({
    versao:2,modo:'previsualizacao',itens:[bad]}),null);
  assert.equal(mod.exports.normalizarExtratoCreditosV2({versao:2,modo:'previsualizacao',itens:Array(41).fill(base)}),null);
  let called=false;
  const response=await mod.exports.buscarExtratoCreditosV2(async(url,options)=>{
    called=true;assert.equal(url,'/api/ai-credits/v2/history');assert.equal(options.credentials,'same-origin');
    return {ok:true,json:async()=>({versao:2,modo:'previsualizacao',itens:[base]})};
  });
  assert.equal(called,true);
  assert.equal(response.itens[0].creditos,5);
  assert.equal(await mod.exports.buscarExtratoCreditosV2(async()=>({ok:false,status:404})),null);
});
