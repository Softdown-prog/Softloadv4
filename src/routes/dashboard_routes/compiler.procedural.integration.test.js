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
