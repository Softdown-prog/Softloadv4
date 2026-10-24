'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizarUsoTokensSolaris, calcularDebitoChatSolaris, calcularDebitoInspecaoSolaris } = require('./solarisBilling');

test('normaliza relatórios válidos sem mudar contagens', () => {
  assert.deepEqual(normalizarUsoTokensSolaris({total:9,input:4,output:5}),{total:9,input:4,output:5});
  assert.deepEqual(normalizarUsoTokensSolaris({input:3,output:7}),{total:10,input:3,output:7});
});
test('descarta strings, NaN, Infinity, negativos e estruturas inválidas', () => {
  assert.deepEqual(normalizarUsoTokensSolaris({input:'5',output:Infinity,total:-4}),{total:0,input:0,output:0});
  assert.deepEqual(normalizarUsoTokensSolaris(null),{total:0,input:0,output:0});
  assert.deepEqual(normalizarUsoTokensSolaris([]),{total:0,input:0,output:0});
  assert.deepEqual(normalizarUsoTokensSolaris({input:1.5,output:Number.MAX_SAFE_INTEGER+1}),{total:0,input:0,output:0});
});
test('preserva cobrança de tokens reais, fallback de caracteres e geração Pro', () => {
  assert.deepEqual(calcularDebitoChatSolaris('xyz','abcdef',{input:4,output:8},{input:10,output:20}),{input:14,output:28});
  assert.deepEqual(calcularDebitoChatSolaris('1234567','abcdefgh',{input:0,output:0}),{input:2,output:3});
});
test('não cria débito de inspeção sem contagens numéricas válidas', () => {
  assert.deepEqual(calcularDebitoInspecaoSolaris({input:4,output:2}),{input:4,output:2});
  assert.deepEqual(calcularDebitoInspecaoSolaris({input:0,output:8}),{input:0,output:8});
  assert.equal(calcularDebitoInspecaoSolaris({input:'99',output:-3}),null);
});
