'use strict';
const assert = require('node:assert/strict');
const { validarDossie } = require('./dossieValidator');
const { NICHO_CHASSIS_MAP, chassisParaNicho, pageTypeParaNicho } = require('../nichoTaxonomy');
const { carregarNichoDossie } = require('./dossieLoader');

const base = () => ({
    nicho:'culinaria-boutique-gourmet',versaoDossie:1,chassis:'blog',pageType:'blogger-conteudo',
    tokensCss:{light_mode:{'--sl-primary':'#2563eb'},dark_mode:{seletor:'dark','--sl-primary':'#111'}},
    pecas:[
        {id:'hero',tipo:'hero',protegida:true,html:'<div id="x"/>',domIds:['x']},
        {id:'modulo',tipo:'modulo',protegida:false,html:'',css:'.a{}',domIds:[]},
    ],
});
function expect(input, erros, avisos=[]) {
    const actual=validarDossie(input);
    assert.deepEqual(actual,{erros,avisos});
    assert.deepEqual(Object.keys(actual),['erros','avisos']);
}
expect(base(),[]);
for(const input of [null,undefined,false,0,3,'string',true]){
    expect(input,['dossiê deve ser um objeto.']);
}
expect({},[
    'campo "nicho" é obrigatório e deve ser string.',
    'campo "versaoDossie" é obrigatório e deve ser number.',
    'tokensCss é obrigatório e deve ser um objeto.',
    'pecas é obrigatório e deve ser um array.',
]);
expect({...base(),nicho:'sem-registro'},[
    'nicho "sem-registro" não existe em nichoTaxonomy.NICHO_CHASSIS_MAP.',
    'nicho "sem-registro" não existe em nichoTaxonomy.NICHO_PAGE_TYPE_MAP.',
]);
expect({...base(),chassis:'magazine',pageType:'landing-page'},[
    'chassis "magazine" diverge de nichoTaxonomy.js (esperado "blog") — fontes de verdade dessincronizadas.',
    'pageType "landing-page" diverge de nichoTaxonomy.js (esperado "blogger-conteudo") — fontes de verdade dessincronizadas.',
]);
expect({...base(),tokensCss:{light_mode:{},dark_mode:{seletor:'x',bad:'red'}}},[
    'tokensCss.dark_mode tem chave "bad" que não é uma variável CSS nem "seletor".',
],['tokensCss.light_mode está vazio.']);
expect({...base(),tokensCss:{light_mode:{bad:'red'},dark_mode:5}},[
    'tokensCss.light_mode tem chave "bad" que não é uma variável CSS (deve começar com --).',
    'tokensCss.dark_mode, quando presente, deve ser um objeto.',
]);
expect({...base(),tokensCss:{light_mode:[],dark_mode:[]}},[
    'tokensCss.light_mode é obrigatório e deve ser um objeto — formato canônico exigido.',
    'tokensCss.dark_mode, quando presente, deve ser um objeto.',
]);
expect({...base(),tokensCss:[]},[
    'tokensCss.light_mode é obrigatório e deve ser um objeto — formato canônico exigido.',
]);
assert.throws(()=>validarDossie({...base(),tokensCss:{light_mode:{'--x':'a'},dark_mode:null}}),TypeError,
    'Comportamento legado do dark_mode null preservado');
expect({...base(),pecas:[]},[],['pecas está vazio — nicho sem nenhum conteúdo próprio.']);
expect({...base(),pecas:[null]},['pecas[0]: deve ser um objeto.']);
expect({...base(),pecas:[{id:'x',tipo:'outro',protegida:'sim',html:'<div/>',domIds:[]}]},[
    'peça "x": "tipo" deve ser um de hero|widget|modulo|secao, veio "outro".',
    'peça "x": campo "protegida" é obrigatório e deve ser boolean.',
    'peça "x": introduz HTML novo (html ou widgetNativo) mas "domIds" está ausente ou vazio — sem domIds não dá pra verificar mecanicamente que esse HTML chegou no output.',
]);
expect({...base(),pecas:[
    {id:'dup',tipo:'widget',protegida:true,domIds:[]},
    {id:'dup',tipo:'secao',protegida:false,domIds:[]},
]},['peça "dup": id duplicado — pecas[].id devem ser únicos.']);
expect({...base(),pecas:[{id:'native',tipo:'secao',protegida:true,widgetNativo:'',domIds:[]}]},[
    'peça "native": introduz HTML novo (html ou widgetNativo) mas "domIds" está ausente ou vazio — sem domIds não dá pra verificar mecanicamente que esse HTML chegou no output.',
]);
expect({...base(),pecas:[{id:'passive',tipo:'modulo',protegida:false,html:' ',domIds:['x'],css:'.x{}'}]},[],
    ['peça "passive": declara domIds mas não tem css nem js — nada a verificar.']);
expect({...base(),versaoDossie:NaN},[],[]);
const items=[
    {id:'ok',tipo:'widget',protegida:true,html:'<p>X</p>',domIds:['x']},
    {id:'bad',tipo:'invalid',protegida:0,html:'<p>X</p>',domIds:[]},
    {id:'css',tipo:'modulo',protegida:false,html:'',domIds:['id']},
    null,
];
const modes=[
    {light_mode:{'--x':'x'}},
    {light_mode:{color:'red'}},
    {light_mode:{}},
    {light_mode:null},
];
let total=0;
for(const mode of modes)for(const a of items)for(const b of items){
    const d={...base(),tokensCss:mode,pecas:[a,b]};
    const once=validarDossie(d),twice=validarDossie(d);
    assert.deepEqual(once,twice);
    assert.deepEqual(Object.keys(once),['erros','avisos']);
    assert.ok(Array.isArray(once.erros)&&Array.isArray(once.avisos));
    total++;
}
for(const nicho of Object.keys(NICHO_CHASSIS_MAP)){
    const d=carregarNichoDossie(nicho);
    if(!d)continue;
    assert.equal(d.chassis,chassisParaNicho(nicho));
    assert.equal(d.pageType,pageTypeParaNicho(nicho));
    const result=validarDossie(d);
    assert.deepEqual(result.erros,[],nicho+' '+result.erros.join(' | '));
    total++;
}
console.log('✅ dossieValidator: '+total+' combinações e dossiês reais com ordem e mensagens preservadas.');
