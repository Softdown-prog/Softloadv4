'use strict';
const assert = require('node:assert/strict');
const { Type } = require('@google/genai');
const { validarPeca, TIPOS_VALIDOS, GEMINI_PECA_RESPONSE_SCHEMA } = require('./pecaRequestSchema');

assert.deepEqual(Object.keys(require('./pecaRequestSchema')),
    ['GEMINI_PECA_RESPONSE_SCHEMA','TIPOS_VALIDOS','validarPeca'],'API CommonJS original intacta');
assert.deepEqual(TIPOS_VALIDOS,['hero','widget','modulo']);
assert.equal(GEMINI_PECA_RESPONSE_SCHEMA.type,Type.OBJECT);
assert.deepEqual(GEMINI_PECA_RESPONSE_SCHEMA.required,['tipo','css','html','js','descricao']);
assert.strictEqual(GEMINI_PECA_RESPONSE_SCHEMA.properties.tipo.enum,TIPOS_VALIDOS);
assert.equal(GEMINI_PECA_RESPONSE_SCHEMA.properties.domIds.type,Type.ARRAY);
assert.ok(!('id' in GEMINI_PECA_RESPONSE_SCHEMA.properties));
assert.ok(!('protegida' in GEMINI_PECA_RESPONSE_SCHEMA.properties));

for(const input of [null,undefined,[],1,true,'texto']){
    const result=validarPeca(input);
    assert.deepEqual(result,{valido:false,erros:['Resposta de peça não é um objeto JSON.'],peca:null});
}
for(const type of ['hero','widget','modulo']){
    const r=validarPeca({tipo:type,css:'  .x{}  ',id:'injetado',protegida:true,
        domIds:['primeiro','botao'],descricao:'  Cria widget  ',extra:'injetado'});
    assert.equal(r.valido,true);
    assert.deepEqual(r.erros,[]);
    assert.deepEqual(r.peca,{tipo:type,protegida:false,domIds:['primeiro','botao'],
        css:'  .x{}  ',html:'',js:'',descricao:'Cria widget'});
    assert.equal(r.peca.id,undefined);
}
for(const field of ['css','html','js']){
    const input={tipo:'hero',css:'.x{}'};
    input[field]=3;
    const r=validarPeca(input);
    assert.equal(r.valido,false,'campo '+field+' não-string invalida a peça');
    assert.equal(r.peca,null);
    assert.ok(r.erros.some(e=>e.includes('"'+field+'"')));
}
for(const input of [
    {tipo:'desconhecido',css:'.x{}',html:'',js:''},
    {tipo:'hero',css:'',html:'  ',js:'  '},
    {tipo:'widget',css:null,html:'',js:''},
]){
    const r=validarPeca(input);
    assert.equal(r.valido,false,'tipo/conteúdo obrigatório inválido');
    assert.equal(r.peca,null);
}
const input={tipo:'modulo',css:'.x{}',domIds:['ok',5],descricao:42};
const warn=validarPeca(input);
assert.equal(warn.valido,true,'metadado inválido gera aviso, não aborta conteúdo');
assert.deepEqual(warn.peca.domIds,[]);
assert.equal(warn.peca.descricao,'');
assert.ok(warn.erros.some(e=>e.includes('domIds')));
assert.deepEqual(input.domIds,['ok',5],'não altera entrada');
const empty=validarPeca({tipo:'widget',html:'<aside></aside>',domIds:[]});
assert.equal(empty.valido,true);
assert.equal(empty.peca.css,'');
assert.equal(empty.peca.js,'');
assert.deepEqual(empty.peca.domIds,[]);
console.log('✅ pecaRequestSchema: limites, campos fatais, avisos, API e imutabilidade.');
