'use strict';
const assert = require('node:assert/strict');
const taxonomy = require('./nichoTaxonomy');
const {
  NICHO_PAGE_TYPE_MAP, NICHO_CHASSIS_MAP, PAGE_TYPES_VALIDOS, PAGE_TYPES_SEM_CHASSIS_DEDICADO,
  pageTypeParaNicho, chassisParaNicho,
} = taxonomy;
const rows = [
  ['gamer-playerone','blogger-conteudo','blog'],
  ['pop-retro-pixel','blogger-conteudo','blog'],
  ['culinaria-boutique-gourmet','blogger-conteudo','blog'],
  ['natureza-bulma-vegan','blogger-conteudo','blog'],
  ['noticias-mag-news','portal-noticias','magazine'],
  ['tecnologia-mag-tech','portal-noticias','magazine'],
  ['tecnologia-techwind','portal-noticias','magazine'],
  ['viral-magazine','magazine','magazine'],
  ['saas-nexus','landing-page','saas'],
  ['brutalista-appcraft','landing-page','saas'],
  ['portfolio-minimalista','landing-page','portfolio'],
  ['aquarela','landing-page','portfolio'],
  ['biolink-social','biolink','biolink'],
  ['elearning-academy','documentacao','blog'],
  ['appstore-bulma-mobile','catalogo-produtos','blog'],
];
const chassisKeyOrder = [
 'noticias-mag-news','viral-magazine','tecnologia-mag-tech','tecnologia-techwind',
 'gamer-playerone','culinaria-boutique-gourmet','natureza-bulma-vegan','pop-retro-pixel',
 'elearning-academy','appstore-bulma-mobile','portfolio-minimalista','aquarela',
 'saas-nexus','brutalista-appcraft','biolink-social',
];
assert.deepEqual(Object.keys(NICHO_PAGE_TYPE_MAP),rows.map(r=>r[0]));
assert.deepEqual(Object.keys(NICHO_CHASSIS_MAP),chassisKeyOrder);
assert.equal(Object.getPrototypeOf(NICHO_PAGE_TYPE_MAP),Object.prototype,'Não usar Object.create(null) nesta migração');
assert.equal(Object.getPrototypeOf(NICHO_CHASSIS_MAP),Object.prototype);
assert.deepEqual([...PAGE_TYPES_VALIDOS],[
 'blogger-conteudo','landing-page','portal-noticias','magazine','biolink','documentacao','catalogo-produtos'
]);
assert.deepEqual([...PAGE_TYPES_SEM_CHASSIS_DEDICADO],['documentacao','catalogo-produtos']);
for(const [key,type,chassis] of rows){
  assert.equal(NICHO_PAGE_TYPE_MAP[key],type,key);
  assert.equal(NICHO_CHASSIS_MAP[key],chassis,key);
  assert.equal(pageTypeParaNicho(key),type,key);
  assert.equal(chassisParaNicho(key),chassis,key);
  assert.ok(PAGE_TYPES_VALIDOS.has(type),key);
  assert.equal(PAGE_TYPES_SEM_CHASSIS_DEDICADO.has(type),type==='documentacao'||type==='catalogo-produtos',key);
}
for(const invalid of ['',null,undefined,'tema-gamer-playerone','GAMER-PLAYERONE','nao-existe',0,false]){
  assert.equal(pageTypeParaNicho(invalid),null,JSON.stringify(invalid));
  assert.equal(chassisParaNicho(invalid),null,JSON.stringify(invalid));
}
assert.equal(typeof pageTypeParaNicho('toString'),'function','Preserva lookup normal sobre Object.prototype');
assert.equal(typeof chassisParaNicho('constructor'),'function','Preserva comportamento JS para chave herdada');
for(const [key] of rows){
  assert.equal(pageTypeParaNicho('tema-'+key),null,'Prefixo tema- é responsabilidade do carregador, não da taxonomia');
}
// Mutabilidade, identidade e keys das coleções permanecem as mesmas.
// Referências exigidas pelo blueprintCritics e pelo worker são preservadas.
const shared = require('./blueprintCritics');
assert.equal(shared.PAGE_TYPES_VALIDOS,PAGE_TYPES_VALIDOS);
console.log('✅ Taxonomia: 15 nichos, 7 pageTypes, 5 famílias, ordem e fallbacks preservados.');
