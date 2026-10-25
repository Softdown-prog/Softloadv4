'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { estimarCustoGemini, extrairTokensFaturaveisGemini, TETOS_IA_EXPERIMENTAIS_CENTAVOS } = require('./geminiCost');

test('calcula tarifas Flash-Lite e Flash incluindo câmbio', () => {
  const lite = estimarCustoGemini({modelo:'gemini-2.5-flash-lite',entrada:3000,saida:1000,cambioBrlPorUsd:5.2});
  assert.equal(lite.custoMicroUsd,700);
  assert.equal(lite.custoMicroBrl,3640);
  const flash = estimarCustoGemini({modelo:'gemini-2.5-flash',entrada:4000,saida:1000,cambioBrlPorUsd:5.2});
  assert.equal(flash.custoMicroUsd,3700);
  assert.equal(flash.custoMicroBrl,19240);
});

test('Pro diferencia prompts acima de 200k tokens', () => {
  assert.equal(estimarCustoGemini({modelo:'gemini-2.5-pro',entrada:200000,saida:40000,cambioBrlPorUsd:5.2}).custoMicroUsd,650000);
  assert.equal(estimarCustoGemini({modelo:'gemini-2.5-pro',entrada:200001,saida:40000,cambioBrlPorUsd:5.2}).custoMicroUsd,1100003);
});

test('desconta tokens em cache do preço cheio sem descontá-los duas vezes', () => {
  const custo = estimarCustoGemini({modelo:'gemini-2.5-flash',entrada:10000,entradaCache:8000,saida:1000,cambioBrlPorUsd:5});
  assert.equal(custo.custoMicroUsd,3340); // 2000*0,30 + 8000*0,03 + 1000*2,5
});

test('rejeita entradas inválidas e modelos não precificados em vez de custo zero', () => {
  const base = {modelo:'gemini-2.5-flash',entrada:3,saida:1,cambioBrlPorUsd:5.2};
  for (const change of [{entrada:-1},{entrada:1.5},{entrada:Infinity},{saida:NaN},{entradaCache:4},{cambioBrlPorUsd:0},{modelo:'gemini-3.1-pro'}]) {
    assert.equal(estimarCustoGemini({...base,...change}),null);
  }
});

test('soma os tokens de pensamento e reconhece cache nas respostas do SDK', () => {
  assert.deepEqual(extrairTokensFaturaveisGemini({promptTokenCount:120,candidatesTokenCount:30,thoughtsTokenCount:80,cachedContentTokenCount:20}),{entrada:120,saida:110,entradaCache:20});
  assert.equal(extrairTokensFaturaveisGemini({promptTokenCount:1,candidatesTokenCount:0,thoughtsTokenCount:-1}),null);
  assert.equal(extrairTokensFaturaveisGemini({promptTokenCount:0}),null);
});

test('limites V2 refletem os créditos já divulgados no checkout, sem alterar preços', () => {
  assert.deepEqual({...TETOS_IA_EXPERIMENTAIS_CENTAVOS},{free:5,starter:500,pro:2000,studio:5500});
});
