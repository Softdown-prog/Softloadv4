require('../../core/test/isolatedTelemetry.cjs');
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {executarCompilacao}=require('../../core/compilerWorker');
const {validarXmlCompilado,validarXmlEstrutura,validarSemanticaBlogger}=require('../../core/xmlValidator');
const {NICHO_PAGE_TYPE_MAP}=require('../../core/nichoTaxonomy');
test('gerador sem IA consegue compilar todos os 15 nichos e a base Blogger',()=>{
  const nichos=[null,...Object.keys(NICHO_PAGE_TYPE_MAP)];
  assert.equal(nichos.length,16);
  for(const nichoTema of nichos) {
    const tema=executarCompilacao({
      siteName:'Teste Blogger Procedural', nichoTema,
      colorPreset:'tech-blue',gridLayout:'revista',sidebarPosition:'right',typography:'inter'
    });
    assert.ok(tema.xmlFinal.length>1000,'XML muito pequeno: '+nichoTema);
    assert.match(tema.xmlFinal,/\bBlog1\b/,'Feed Blogger ausente: '+nichoTema);
    const errors=[...validarXmlCompilado(tema.xmlFinal),
      ...validarXmlEstrutura(tema.xmlFinal).erros,
      ...validarSemanticaBlogger(tema.xmlFinal).erros];
    assert.deepEqual(errors,[],'XML não válido para nicho '+nichoTema);
  }
});


// A curated gallery is not an exhaustive compiler test: every niche must
// survive every supported grid family, independent of the 30 gallery cards.
// Deliberately bounded (16 x 7 = 112 cases), deterministic, offline, no I/O.
const {COLOR_PRESETS,TYPOGRAPHY_PRESETS}=require('../../core/presets');
const PERFIS=Object.freeze([
  {id:'revista-base',gridLayout:'revista',sidebarPosition:'right',typography:'inter',colorPreset:'tech-blue'},
  {id:'lista-editorial',gridLayout:'lista',sidebarPosition:'left',typography:'playfair',colorPreset:'clean-white-graphite'},
  {id:'quadrado-gamer',gridLayout:'quadrado',sidebarPosition:'none',typography:'oswald',colorPreset:'gamer-dark-cyan'},
  {id:'dupla-organica',gridLayout:'dupla',sidebarPosition:'right',typography:'pt-sans',colorPreset:'forest-green-sage'},
  {id:'mural-tecnologico',gridLayout:'mural',sidebarPosition:'left',typography:'space-grotesk',colorPreset:'carbon-dark-teal'},
  {id:'coluna-leitura',gridLayout:'coluna-unica',sidebarPosition:'none',typography:'roboto-slab',colorPreset:'warm-amber-honey'},
  {id:'zigzag-criativo',gridLayout:'zigzag',sidebarPosition:'right',typography:'inter',colorPreset:'rose-gold-blush'},
]);
test('matriz cobre todos os layouts, sidebars, fontes e presets reais',()=>{
  assert.equal(PERFIS.length,7);
  assert.deepEqual(new Set(PERFIS.map(p=>p.gridLayout)),
    new Set(['revista','lista','quadrado','dupla','mural','coluna-unica','zigzag']));
  assert.deepEqual(new Set(PERFIS.map(p=>p.sidebarPosition)),new Set(['right','left','none']));
  assert.deepEqual(new Set(PERFIS.map(p=>p.typography)),
    new Set(Object.keys(TYPOGRAPHY_PRESETS)));
  assert.equal(new Set(PERFIS.map(p=>p.colorPreset)).size,7);
  for(const p of PERFIS){
    assert.ok(Object.hasOwn(COLOR_PRESETS,p.colorPreset),p.id+' cor não suportada');
    assert.ok(Object.hasOwn(TYPOGRAPHY_PRESETS,p.typography),p.id+' fonte não suportada');
  }
});
test('16 estruturas x 7 perfis geram 112 XMLs Blogger válidos sem IA e sem rede',
  {timeout:180000},()=>{
  const nichos=[null,...Object.keys(NICHO_PAGE_TYPE_MAP)];
  assert.equal(nichos.length,16,'aumentou o catálogo: revisar cobertura da matriz');
  let count=0;
  for(const nichoTema of nichos){
    for(const perfil of PERFIS){
      const scenario=(nichoTema??'base')+'/'+perfil.id;
      const {xmlFinal}=executarCompilacao({
        siteName:'Validacao Blogger Matriz',nichoTema,
        colorPreset:perfil.colorPreset,typography:perfil.typography,
        gridLayout:perfil.gridLayout,sidebarPosition:perfil.sidebarPosition
      },{telemetry:false});
      assert.ok(xmlFinal.length>1000,scenario+' XML pequeno');
      assert.match(xmlFinal,/id=['"]Blog1['"]/,scenario+' widget Blog1 ausente');
      assert.deepEqual(validarXmlCompilado(xmlFinal),[],scenario+' sintaxe');
      assert.deepEqual(validarXmlEstrutura(xmlFinal).erros,[],scenario+' estrutura');
      assert.deepEqual(validarSemanticaBlogger(xmlFinal).erros,[],scenario+' semântica');
      count++;
    }
  }
  assert.equal(count,112);
});
