'use strict';
require('../core/test/isolatedTelemetry.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { listarExemplos, encontrarExemplo } = require('./exampleGallery.cjs');
const { executarCompilacao } = require('../core/compilerWorker');
const { validarXmlCompilado, validarXmlEstrutura, validarSemanticaBlogger } = require('../core/xmlValidator');
const { COLOR_PRESETS, TYPOGRAPHY_PRESETS } = require('../core/presets');
const { NICHO_PAGE_TYPE_MAP } = require('../core/nichoTaxonomy');

test('galeria tem 22 exemplos reais, únicos e apenas opções aceitas pelo compilador', () => {
  const examples = listarExemplos();
  assert.equal(examples.length, 22);
  assert.equal(new Set(examples.map(item => item.id)).size, examples.length);
  assert.ok(new Set(examples.map(item => item.nichoTema)).size >= 15);
  assert.ok(new Set(examples.map(item => item.colorPreset)).size >= 15);
  for (const item of examples) {
    assert.ok(Object.hasOwn(NICHO_PAGE_TYPE_MAP, item.nichoTema), item.id);
    assert.ok(Object.hasOwn(COLOR_PRESETS, item.colorPreset), item.id);
    assert.ok(Object.hasOwn(TYPOGRAPHY_PRESETS, item.typography), item.id);
    assert.equal(encontrarExemplo(item.id), item);
    assert.ok(item.nome.length >= 2 && item.nome.length <= 60);
    assert.match(item.accent, /^#[0-9a-f]{6}$/i);
  }
  assert.equal(encontrarExemplo('inexistente'), null);
});

// Compila os mesmos campos que o form envia no download. Sem rede e sem IA.
test('todos os 22 exemplos geram XML Blogger válido e com widget Blog1', {timeout: 180000}, () => {
  const hashes = new Set();
  for (const item of listarExemplos()) {
    const { xmlFinal } = executarCompilacao({
      siteName:item.nome, nichoTema:item.nichoTema, colorPreset:item.colorPreset,
      typography:item.typography, gridLayout:item.gridLayout, sidebarPosition:item.sidebarPosition
    });
    assert.ok(xmlFinal.length > 1000, item.id + ' incompleto');
    assert.deepEqual(validarXmlCompilado(xmlFinal), [], item.id + ' sintaxe');
    assert.deepEqual(validarXmlEstrutura(xmlFinal).erros, [], item.id + ' estrutura');
    assert.deepEqual(validarSemanticaBlogger(xmlFinal).erros, [], item.id + ' semântica');
    assert.match(xmlFinal, /id=['"]Blog1['"]/, item.id + ' sem posts');
    const signature = require('node:crypto').createHash('sha256').update(xmlFinal).digest('hex');
    assert.ok(!hashes.has(signature), item.id + ' duplicado');
    hashes.add(signature);
  }
  assert.equal(hashes.size, listarExemplos().length);
});

test('galeria aparece na página e não altera fluxo de downloads nem exige login', async () => {
  const examples = listarExemplos();
  const html = await ejs.renderFile(path.join(__dirname,'../../views/pages/gerador-blogger.ejs'),{
    gitSha:'gallery-contract',user:null,guestMode:true,guestToken:'a'.repeat(48),
    activePage:null,downloadPath:'/criar/download',gratuitoLimite:2,
    nichos:Object.keys(NICHO_PAGE_TYPE_MAP).map(id=>({id,nome:id,aviso:null})),
    cores:Object.entries(COLOR_PRESETS).map(([id,p])=>({id,nome:p.label,hex:p.primary})),
    fontes:Object.entries(TYPOGRAPHY_PRESETS).map(([id,p])=>({id,nome:p.label})),
    exemplos:examples
  });
  assert.equal((html.match(/class="example-choice"/g)||[]).length, 22);
  assert.match(html,/id="example-gallery-title"/);
  assert.match(html,/data-example-id="noticias-elegante"/);
  assert.match(html,/data-example-id="biolink-social"/);
  assert.match(html,/data-hex="#0ea5e9"/);
  assert.match(html,/data-gallery-filter="Tecnologia"/);
  assert.match(html,/action="\/criar\/download"/);
  assert.match(html,/name="guestToken"/);
  assert.match(html,/id="download-template"/);
  assert.match(html,/Miniaturas ilustrativas|Miniaturas ilustrativas|Miniaturas ilustrativas|Miniaturas ilustrativas/i);
});
