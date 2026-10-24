'use strict';
const assert = require('node:assert/strict');
const { Type } = require('@google/genai');
const { ENUMS } = require('./blueprintSchema');
const { BUTTON_STYLES } = require('../core/presets');
const { EDIT_ENUMS, GEMINI_EDIT_RESPONSE_SCHEMA, validarEdicao } = require('./templateEditSchema');

assert.deepEqual(Object.keys(require('./templateEditSchema')), [
    'GEMINI_EDIT_RESPONSE_SCHEMA', 'EDIT_ENUMS', 'validarEdicao'
], 'CommonJS mantém API pública original');
assert.strictEqual(EDIT_ENUMS.colorPreset, ENUMS.colorPreset, 'as cores reutilizam o catálogo existente');
assert.strictEqual(EDIT_ENUMS.typography, ENUMS.typography);
assert.strictEqual(EDIT_ENUMS.designVoice, ENUMS.designVoice);
assert.deepEqual(EDIT_ENUMS.buttonStyle, Object.keys(BUTTON_STYLES));
assert.deepEqual(EDIT_ENUMS.mobileMenuType,['classico','offcanvas']);
assert.deepEqual(EDIT_ENUMS.commentsSystem,['desativado','nativo','disqus']);
assert.equal(EDIT_ENUMS.commentsSystem.includes(''),false,'Gemini nunca recebe enum vazio');
assert.equal(GEMINI_EDIT_RESPONSE_SCHEMA.type,Type.OBJECT);
assert.deepEqual(GEMINI_EDIT_RESPONSE_SCHEMA.required,['resumoMudancas']);
assert.strictEqual(GEMINI_EDIT_RESPONSE_SCHEMA.properties.colorPreset.enum,EDIT_ENUMS.colorPreset);
assert.strictEqual(GEMINI_EDIT_RESPONSE_SCHEMA.properties.modules.properties.commentsSystem.enum,EDIT_ENUMS.commentsSystem);
assert.equal(GEMINI_EDIT_RESPONSE_SCHEMA.properties.heroTitle.nullable,true);
assert.equal(GEMINI_EDIT_RESPONSE_SCHEMA.properties.modules.properties.cookieBanner.type,Type.BOOLEAN);
assert.equal(GEMINI_EDIT_RESPONSE_SCHEMA.properties.categoryBadges.type,Type.ARRAY);
for (const invalid of [null, [], 1, 'não-json', true]) {
    const result=validarEdicao(invalid);
    assert.deepEqual(result,{valido:false,erros:['Resposta de edição não é um objeto JSON.'],camposAlterados:{},resumoMudancas:''});
}
const empty=validarEdicao({});
assert.deepEqual(empty,{valido:true,erros:[],camposAlterados:{},resumoMudancas:''},'edição parcial vazia segue contrato legado');
const valid=validarEdicao({
    resumoMudancas:'  Atualizar nome e layout  ',
    siteName:'Novo Blog', colorPreset:EDIT_ENUMS.colorPreset[0],
    heroTitle:null,heroSubtitle:'Subtítulo',enableSeo:false,lazyLoad:true,darkTheme:false,
    categoryBadges:[{nome:'A',bg:'#fff'},{nome:'B'},null,{},'C',...Array.from({length:12},(_,i)=>({nome:'Extra'+i}))],
    modules:{backToTop:false,darkMode:true,mobileMenuType:'offcanvas',commentsSystem:'desativado',admin:true},
    unknown:'INJETADO'
});
assert.equal(valid.valido,true);
assert.deepEqual(valid.erros,[]);
assert.equal(valid.resumoMudancas,'Atualizar nome e layout');
assert.equal(valid.camposAlterados.siteName,'Novo Blog');
assert.equal(valid.camposAlterados.heroTitle,null);
assert.equal(valid.camposAlterados.enableSeo,false);
assert.equal(valid.camposAlterados.lazyLoad,true);
assert.equal(valid.camposAlterados.darkTheme,false);
assert.deepEqual(valid.camposAlterados.categoryBadges.map(x=>x.nome),['A','B','Extra0','Extra1','Extra2','Extra3','Extra4','Extra5'],'badges inválidos filtrados antes do limite de oito');
assert.deepEqual(valid.camposAlterados.modules,{backToTop:false,darkMode:true,mobileMenuType:'offcanvas',commentsSystem:''});
assert.equal(valid.camposAlterados.unknown,undefined,'whitelist ignora campos arbitrários');

const mixed=validarEdicao({
    resumoMudancas:'Salvar campos válidos',
    siteName:' ',colorPreset:'fora-do-catalogo',heroTitle:42,heroSubtitle:null,
    lazyLoad:'false', darkTheme:true, customCss:'.x{color:red}',
    categoryBadges:'inválido', modules:{darkMode:'true',cookieBanner:false,mobileMenuType:'mega-menu',commentsSystem:'não-existe'}
});
assert.equal(mixed.valido,false,'erros são reportados sem perder os campos válidos');
assert.equal(mixed.camposAlterados.heroSubtitle,null);
assert.equal(mixed.camposAlterados.darkTheme,true);
assert.equal(mixed.camposAlterados.customCss,'.x{color:red}');
assert.deepEqual(mixed.camposAlterados.modules,{cookieBanner:false});
assert.equal(mixed.camposAlterados.colorPreset,undefined);
assert.ok(mixed.erros.some(s=>s.includes('colorPreset')));
assert.ok(mixed.erros.some(s=>s.includes('modules.darkMode')));
assert.ok(mixed.erros.some(s=>s.includes('categoryBadges')));

const emptyModules=validarEdicao({modules:{admin:true,backToTop:3}});
assert.equal(emptyModules.valido,false);
assert.ok(!('modules' in emptyModules.camposAlterados),'nenhum módulo inválido entra no merge');
const badModules=validarEdicao({modules:['darkMode']});
assert.ok(badModules.erros.some(s=>s.includes('"modules"')));
const allowedComments=validarEdicao({modules:{commentsSystem:'nativo',mobileMenuType:'classico'}});
assert.deepEqual(allowedComments.camposAlterados.modules,{mobileMenuType:'classico',commentsSystem:'nativo'});
const badges=Array.from({length:10},(_,i)=>({nome:'Categoria '+i}));
const clipped=validarEdicao({categoryBadges:badges});
assert.equal(clipped.camposAlterados.categoryBadges.length,8);
assert.equal(badges.length,10,'validação não muta os arrays de entrada');
console.log('✅ templateEditSchema: enums, schema Gemini, campos opcionais, filtros, módulos e erros parciais.');
