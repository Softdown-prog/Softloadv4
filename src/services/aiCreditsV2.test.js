'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {converterCustoEmCreditosV2,converterSaldoEmCreditosV2,simularConsumoCreditosV2,MICRO_BRL_POR_CREDITO_V2}=require('./aiCreditsV2');

test('converte micro-BRL em créditos inteiros sem arredondar custo para baixo',()=>{
  assert.equal(MICRO_BRL_POR_CREDITO_V2,10000);
  for(const [c,expected] of [[0,0],[1,1],[9999,1],[10000,1],[10001,2],[120001,13]]) {
    assert.equal(converterCustoEmCreditosV2(c),expected);
  }
  for(const invalid of [-1,Infinity,NaN,1.9]) assert.equal(converterCustoEmCreditosV2(invalid),null);
});

test('saldo mostra orçamento real em créditos e reserva sem adiantar disponibilidade',()=>{
  assert.deepEqual(converterSaldoEmCreditosV2({
    limiteMicroBrl:2_000_000, gastoMicroBrl:355_000, reservadoMicroBrl:102_000,
  }),{
    creditosDoCiclo:200, creditosDisponiveis:154,creditosConsumidos:36,
    creditosReservados:11,creditosExcedentes:0,unidadeMicroBrl:10000,preliminar:true
  });
  assert.equal(converterSaldoEmCreditosV2({limiteMicroBrl:20000,gastoMicroBrl:25000,reservadoMicroBrl:15000}).creditosDisponiveis,0);
  assert.equal(converterSaldoEmCreditosV2({limiteMicroBrl:20000,gastoMicroBrl:25000,reservadoMicroBrl:15000}).creditosExcedentes,1);
});

test('aceita orçamento vazio, rejeita entradas adulteradas e overflow',()=>{
  assert.equal(converterSaldoEmCreditosV2({limiteMicroBrl:50000,gastoMicroBrl:0,reservadoMicroBrl:0}).creditosDisponiveis,5);
  for(const saldo of [null, {},{limiteMicroBrl:-1,gastoMicroBrl:0,reservadoMicroBrl:0},
    {limiteMicroBrl:20000,gastoMicroBrl:NaN,reservadoMicroBrl:0},
    {limiteMicroBrl:Number.MAX_SAFE_INTEGER,gastoMicroBrl:Number.MAX_SAFE_INTEGER,reservadoMicroBrl:100}]) {
    assert.equal(converterSaldoEmCreditosV2(saldo),null);
  }
});

test('tarefa equivalente no Gemini Pro custa mais créditos que Flash e Flash-Lite',()=>{
  const uso={entrada:12000,saida:3000,cambioBrlPorUsd:5.2};
  const lite=simularConsumoCreditosV2({...uso,modelo:'gemini-2.5-flash-lite'});
  const flash=simularConsumoCreditosV2({...uso,modelo:'gemini-2.5-flash'});
  const pro=simularConsumoCreditosV2({...uso,modelo:'gemini-2.5-pro'});
  assert.ok(lite.creditosEstimados < flash.creditosEstimados);
  assert.ok(flash.creditosEstimados < pro.creditosEstimados);
  assert.deepEqual([lite.preliminar,flash.preliminar,pro.preliminar],[true,true,true]);
  assert.equal(simularConsumoCreditosV2({...uso,modelo:'gemini-futuro'}),null);
});

test('cache reduz crédito estimado e pensamentos podem aumentar o custo cobrado',()=>{
  const uso={modelo:'gemini-2.5-pro',entrada:20000,saida:2000,cambioBrlPorUsd:5.2};
  const semCache=simularConsumoCreditosV2(uso);
  const comCache=simularConsumoCreditosV2({...uso,entradaCache:15000});
  const thinking=simularConsumoCreditosV2({...uso,saida:4000});
  assert.ok(comCache.creditosEstimados < semCache.creditosEstimados);
  assert.ok(thinking.creditosEstimados > semCache.creditosEstimados);
});
