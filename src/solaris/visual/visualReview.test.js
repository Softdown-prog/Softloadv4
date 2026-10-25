'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarHandlerVisual, validarAlvoVisual } = require('./visualReview');

const png = Buffer.from('89504e470d0a1a0a12345678', 'hex');
const screenshot = {mimeType:'image/png',dataBase64:png.toString('base64'),bytes:png.length,fullPage:false};
const config = {
    enabled:true,
    origins:'https://preview.example.test,https://sites.example.test:8443',
};
function fakeResponse() {
    return {
        statusCode:200,body:null,
        status(code){this.statusCode=code;return this;},
        json(body){this.body=body;return this;},
    };
}
function harness(overrides={}) {
    const calls={capturar:[],modelo:[],debito:[]};
    const deps={
        ...config,
        async capturar(args){calls.capturar.push(args);return {success:true,screenshot};},
        criarRouter(){return {async executarAuditoriaVisual(input){
            calls.modelo.push(input);
            return {texto:'Layout: contraste insuficiente na navegação.',tokens:{input:1222,output:100,total:1322}};
        }};},
        async debitarCreditos(...args){calls.debito.push(args);},
        ...overrides,
    };
    return {handler:criarHandlerVisual(deps),calls};
}
function req(url='https://preview.example.test/',device='desktop') {
    return {body:{url,device},session:{user:{email:'tester@example.test'}}};
}

test('só aceita origins configuradas exatamente, não subdomínios, credentials ou URLs externas',()=>{
    assert.equal(validarAlvoVisual('https://preview.example.test/page',config.origins),'https://preview.example.test/page');
    for(const url of [
        'https://evil.example.test/','https://preview.example.test.evil.test/',
        'https://username:password@preview.example.test/',
        'http://preview.example.test/','https://preview.example.test/?token=secret',
        'https://preview.example.test/#secret','file:///etc/passwd',
    ]) assert.throws(()=>validarAlvoVisual(url,config.origins));
    assert.throws(()=>validarAlvoVisual('https://preview.example.test/',''));
});

test('operação opt-in captura PNG via sandbox, encaminha bytes ao modelo e debita', async()=>{
    const {handler,calls}=harness();
    const res=fakeResponse();
    await handler(req(),res);
    assert.equal(res.statusCode,200);
    assert.equal(res.body.ok,true);
    assert.equal(res.body.analise,'Layout: contraste insuficiente na navegação.');
    assert.equal(calls.capturar.length,1);
    assert.equal(calls.modelo.length,1);
    assert.equal(calls.modelo[0].screenshot.dataBase64,screenshot.dataBase64);
    assert.equal(calls.debito.length,1);
    assert.deepEqual(calls.debito[0].slice(0,3),['tester@example.test',1222,100]);
    assert.match(calls.debito[0][3],/^[a-f0-9-]{36}$/);
    assert.equal(JSON.stringify(res.body).includes('dataBase64'),false);
    assert.equal(JSON.stringify(res.body).includes(screenshot.dataBase64),false);
});

test('flag desativada e sessão ausente nunca geram captura ou custo', async()=>{
    const {handler,calls}=harness({enabled:false});
    const res=fakeResponse();
    await handler(req(),res);
    assert.equal(res.statusCode,404);
    const {handler:enabled,calls:activeCalls}=harness();
    const res2=fakeResponse();
    await enabled({body:{url:'https://preview.example.test/'}},res2);
    assert.equal(res2.statusCode,401);
    assert.equal(calls.capturar.length,0);
    assert.equal(activeCalls.modelo.length,0);
});

test('URL arbitrária/dispositivo inválido bloqueados antes do sandbox',async()=>{
    const {handler,calls}=harness();
    const res=fakeResponse();
    await handler(req('https://attacker.example.test/'),res);
    assert.equal(res.statusCode,400);
    const res2=fakeResponse();
    await handler(req('https://preview.example.test/','webkit'),res2);
    assert.equal(res2.statusCode,400);
    assert.equal(calls.capturar.length,0);
});

test('falha do sandbox ou PNG grande não chega ao Gemini',async()=>{
    for(const capture of [
        async()=>({success:false}),
        async()=>({success:true,screenshot:{...screenshot,bytes:512*1024+1}}),
    ]) {
        const {handler,calls}=harness({capturar:capture});
        const res=fakeResponse();
        await handler(req(),res);
        assert.ok([502,422].includes(res.statusCode));
        assert.equal(calls.modelo.length,0);
        assert.equal(calls.debito.length,0);
    }
});

test('falha de orçamento bloqueia sucesso mesmo se a captura ocorreu',async()=>{
    const {handler,calls}=harness({criarRouter:()=>({
        async executarAuditoriaVisual(){throw Error('ORCAMENTO_INSUFICIENTE');}
    })});
    const res=fakeResponse();
    await handler(req(),res);
    assert.equal(res.statusCode,402);
    assert.equal(calls.debito.length,0);
});
