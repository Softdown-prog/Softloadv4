'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parsearDossie, carregarNichoDossie, limparCache } = require('./dossieLoader');
const { carregarNichoDossie: exported } = require('./index');
assert.equal(exported,carregarNichoDossie);

const make=(nicho,extra={})=>({
    nicho,pecas:[{id:'hero',tipo:'hero',protegida:true}],tokensCss:{light_mode:{'--x':'#123456'}},...extra,
});
assert.deepEqual(parsearDossie(JSON.stringify(make('saas-nexus')),'saas-nexus'),make('saas-nexus'));
assert.throws(()=>parsearDossie('{invalido','saas-nexus'),/\[DOSSIE\] Nicho "saas-nexus": JSON inválido:/);
for(const invalid of ['null','[]','""','3','true','{}',JSON.stringify(make('outro')),
    JSON.stringify(make('saas-nexus',{pecas:null})),
    JSON.stringify(make('saas-nexus',{pecas:{}})),
    JSON.stringify(make('saas-nexus',{tokensCss:null})),
    JSON.stringify(make('saas-nexus',{tokensCss:0}))]){
    assert.throws(()=>parsearDossie(invalid,'saas-nexus'),
        /\[DOSSIE\] Nicho "saas-nexus": contrato inválido \(nicho\/pecas\/tokensCss\)\./);
}
assert.deepEqual(parsearDossie(JSON.stringify(make('saas-nexus',{tokensCss:[]})),'saas-nexus').tokensCss,[],
    'A checagem superficial legada aceita array em tokensCss; validação canônica é responsabilidade separada');
for(const input of [null,undefined,false,0,7,{},[],true,'']) {
    assert.equal(carregarNichoDossie(input),null);
}
const temas=path.resolve(__dirname,'../../../src/blogger/nichos');
const nicho='etapa25-loader-'+process.pid;
const filename=path.join(temas,'tema-'+nicho+'-dossie.json');
assert.equal(fs.existsSync(filename),false,'Não sobrescrever dossiê real');
try {
    limparCache();
    assert.equal(carregarNichoDossie(nicho),null);
    fs.writeFileSync(filename,JSON.stringify(make(nicho,{versaoDossie:1})),'utf8');
    assert.equal(carregarNichoDossie(nicho),null,'Cache negativo preservado');
    limparCache();
    const first=carregarNichoDossie(nicho);
    assert.equal(first.nicho,nicho);
    assert.equal(carregarNichoDossie(nicho),first,'Mesma referência no cache');
    assert.equal(carregarNichoDossie('tema-'+nicho),first,'Alias normalizado');
    fs.writeFileSync(filename,JSON.stringify(make(nicho,{versaoDossie:2})),'utf8');
    assert.equal(carregarNichoDossie(nicho),first,'Cache não relê disco');
    limparCache();
    const second=carregarNichoDossie(nicho);
    assert.notEqual(second,first);
    assert.equal(second.versaoDossie,2);

    fs.writeFileSync(filename,'{broken-json','utf8');
    limparCache();
    assert.throws(()=>carregarNichoDossie(nicho),/\[DOSSIE\].*JSON inválido/);
    fs.writeFileSync(filename,JSON.stringify(make('outro')),'utf8');
    assert.throws(()=>carregarNichoDossie(nicho),/\[DOSSIE\].*contrato inválido/);
    fs.writeFileSync(filename,JSON.stringify(make(nicho,{versaoDossie:3})),'utf8');
    const recovered=carregarNichoDossie(nicho);
    assert.equal(recovered.versaoDossie,3,'Falha de leitura não entra no cache');
    fs.unlinkSync(filename);
    assert.equal(carregarNichoDossie(nicho),recovered,'Cache positivo mantém conteúdo após apagar arquivo');
    limparCache();
    assert.equal(carregarNichoDossie(nicho),null,'Arquivo ausente deve retornar null após limpar cache');
} finally {
    fs.rmSync(filename,{force:true});
    limparCache();
}
const real=carregarNichoDossie('saas-nexus');
assert.ok(real&&real.nicho==='saas-nexus'&&Array.isArray(real.pecas));
assert.equal(carregarNichoDossie('tema-saas-nexus'),real);
console.log('✅ dossieLoader: contratos, cache positivo/negativo, aliases, corrupção, recuperação e dossiê real.');
