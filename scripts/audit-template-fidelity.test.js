'use strict';
const assert=require('node:assert/strict');
const {signatures,comparison,auditNiche}=require('./audit-template-fidelity');
{
 const original=signatures("<b:section id='hero'/><b:section id='main'/>"+
     "<b:widget type='Blog'/><b:widget type='HTML'/>");
 const generated=signatures("<b:section id='main'/><b:widget type='Blog'/>");
 const x=comparison(original,generated);
 assert.equal(x.sectionCoverage,0.5);
 assert.equal(x.widgetCoverage,0.5);
 assert.equal(x.scoreEstrutural,50);
 assert.deepEqual(x.missingSections,['hero']);
 assert.deepEqual(x.missingWidgets,['HTML']);
}
{
 const a=auditNiche('saas-nexus','Auditoria de Contrato');
 assert.ok(a.generated.bootstrapCss5 && a.generated.bootstrapJs5,
    'Bootstrap 5 CSS e bundle devem estar no XML entregue');
 assert.equal(a.diagnostic.errors,0,'não gerar XML com erro estrutural');
 // exemplos/*.xml são referências externas opcionais e não estão
 // versionados neste repositório. Sem referência, ainda validamos o XML
 // compilado, mas NÃO inventamos uma nota de fidelidade estrutural.
 if (a.example) {
  assert.ok(a.reference,'referência informada deve gerar comparação');
  assert.ok(a.reference.originalSections>0,'comparação precisa de seções originais');
 } else {
  assert.equal(a.reference,null,'sem XML original, não há comparação válida');
  console.warn('[QUALIDADE] saas-nexus sem XML original: comparação indisponível (registrada no relatório)');
 }
}
{
 const orig=signatures("<b:section id='profile-section'/><b:section id='footer-copyright'/>");
 const gen=signatures("<b:section id='header-logo'/>");
 const comparison1=comparison(orig,gen,{'profile-section':'header-logo'});
 assert.deepEqual(comparison1.renamedSections,[{oldId:'profile-section',newId:'header-logo'}]);
 assert.deepEqual(comparison1.missingSections,['footer-copyright']);
}
{
 const art=auditNiche('aquarela','Auditoria de Referência');
 if (art.example) {
  assert.equal(art.originalFramework.bootstrapCss5,false);
 } else {
  assert.equal(art.originalFramework,null,'sem original, não inferir o framework original');
  console.warn('[QUALIDADE] aquarela sem XML original: comparação indisponível (registrada no relatório)');
 }
 assert.equal(art.generated.bootstrapCss5,false);
 assert.equal(art.blocked,false,'o tema autoral sem Bootstrap não deve ser falsamente bloqueado');
}
console.log('OK - audit-template-fidelity: assinaturas, regressões e compilação real');
