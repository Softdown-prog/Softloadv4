'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname,'openaiService.js'),'utf8');
function fixture(env) {
    const requests=[],clients=[];
    class FakeOpenAI {
        constructor(config){clients.push(config);}
        chat={completions:{create:async params=>{
            requests.push(params);
            async function* stream() {
                yield {choices:[{delta:{content:'Olá '}}]};
                yield {choices:[{delta:{content:'mundo'}}],usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10}};
            }
            return stream();
        }}};
    }
    const module={exports:{}};
    vm.runInNewContext(code,{
        module,exports:{},require(spec){assert.equal(spec,'openai');return FakeOpenAI;},
        process:{env},Date,console:{warn(){}}
    });
    return {...module.exports,requests,clients};
}
test('stream GPT preserva papéis, streaming e contagem real de tokens',async()=>{
    const f=fixture({OPENAI_API_KEY:'fixture',GPT_MODEL_NAME:'gpt-5.4-nano'});
    const tokens={};const chunks=[];
    for await(const chunk of f.gerarChatGptStream([{role:'assistant',content:'contexto'},{role:'user',content:'pergunta'}],'resposta','regras',{maxOutputTokens:600,tokensRef:tokens})){chunks.push(chunk);}
    assert.deepEqual(chunks,['Olá ','mundo']);
    assert.deepEqual(Array.from(f.requests[0].messages,m=>m.role),['system','assistant','user','user']);
    assert.equal(f.requests[0].temperature,0.7);
    assert.equal(f.requests[0].max_completion_tokens,600);
    assert.equal(f.requests[0].stream_options.include_usage,true);
    assert.deepEqual(tokens,{input:7,output:3,total:10});
    assert.equal(f.clients.length,1);
    assert.equal(f.clients[0].apiKey,'fixture');
});
test('modelo de raciocínio não envia temperature',async()=>{
    const f=fixture({OPENAI_API_KEY:'fixture',GPT_MODEL_NAME:'o3-mini'});
    for await(const _ of f.gerarChatGptStream([],'oi','prompt')){}
    assert.equal(Object.hasOwn(f.requests[0],'temperature'),false);
});
test('falta de chave impede chamada ao provedor',async()=>{
    const f=fixture({});
    await assert.rejects(async()=>{for await(const _ of f.gerarChatGptStream([],'oi','system')){}},/OPENAI_API_KEY/);
    assert.equal(f.clients.length,0);
});
